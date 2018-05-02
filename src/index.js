import InputDataDecoder from 'ethereum-input-data-decoder';
import Web3 from 'web3';
import { erc20Abi } from './constant';
import { promisifyAll } from 'bluebird';
import redis from 'redis';

const decoder = new InputDataDecoder(erc20Abi);

const $r = redis.createClient();

$r.on('error', function (err) {
  console.log('Error ' + err);
});

promisifyAll(redis.RedisClient.prototype);
promisifyAll(redis.Multi.prototype);

export default class CryptoIncome {
  async init({
    ETHnet, // ws provider addrees
    startBlockNum, // will work at first time
    fillingReqQuantity,
    incomeCallback,
    pendingCallback,
  }) {
    this.web3 = new Web3(new Web3.providers.WebsocketProvider(ETHnet));
    this.fillingReqQuantity = fillingReqQuantity;
    this.incomeCallback = incomeCallback;
    this.pendingCallback = pendingCallback;
    if (!await $r.lindexAsync('scannedRanges', 0)) {
      await $r.lpushAsync('scannedRanges', JSON.stringify({
        start: startBlockNum - 1,
        end: startBlockNum - 1,
      }));
    }
    this.subscribeNewBlocks();
    this.subscribePendingTx();
    this.fillMissingBlocks();
  }

  subscribePendingTx() {
    this.web3.eth.subscribe('pendingTransactions', (error) => {
      if (error) {
        console.log(error);
      }     
    }).on('data', async (txHash) => {
      // console.log('pendingTransaction', txHash);
      const watchList = await $r.smembersAsync('watchList');
      const tx = await this.web3.eth.getTransaction(txHash);

      if (tx) {
        const { resultTx } = this.watchTransaction({
          tx,
          watchList,
        });

        if (resultTx) {
          this.pendingCallback(resultTx);
        }
      }
    });
  }

  subscribeNewBlocks() {
    this.web3.eth.subscribe('newBlockHeaders', (error) => {
      if (error) {
        console.log(error);
      }     
    }).on('data', async (blockHeader) => {
      if (blockHeader) {
        const latestRange = JSON.parse(await $r.lindexAsync('scannedRanges', 0));

        this.scanETHBlock(blockHeader.number, async () => {
          console.log('blockNumber', blockHeader.number);
          this.currentBlockNumber = blockHeader.number;
          if (Number(latestRange.end) + 1 === blockHeader.number) {
            $r.lsetAsync('scannedRanges', 0, JSON.stringify({
              start: latestRange.start,
              end: blockHeader.number,
            }));
          } else if (Number(latestRange.end) === blockHeader.number) {
            // replace an exsist block, should do nothing   
          } else {
            await $r.lpushAsync('scannedRanges', JSON.stringify({
              start: blockHeader.number,
              end: blockHeader.number,
            }));
            if (this.fillStopped) {
              this.fillMissingBlocks();
            }
          }
        });
        this.getConfirmations(blockHeader.number);
      }
    });
  }

  async fillMissingBlocks() {
    this.fillStopped = false;
    const earliestRangeString = await $r.lindexAsync('scannedRanges', -1);
    const earliestRange = JSON.parse(earliestRangeString);
    const nextRangeString = await $r.lindexAsync('scannedRanges', -2);

    if (nextRangeString) {
      const nextRange = JSON.parse(nextRangeString);
      const missingBlockCount = nextRange.start - (earliestRange.end + 1);
      const shouldReqCount = Math.min(this.fillingReqQuantity, missingBlockCount);

      await Promise.all(new Array(shouldReqCount).fill(1)
        .map((item, index) => new Promise((resolve) => {
          this.scanETHBlock(earliestRange.end + 1 + index, () => {
            resolve();
          });
        }))
      );

      if (earliestRange.end + shouldReqCount + 1 === nextRange.start) {
        // After the promise resolved, nextRange could be changed by another functions
        const newNextRange = JSON.parse(await $r.lindexAsync('scannedRanges', -2));

        await $r.multi()
        .lset('scannedRanges', -2, JSON.stringify({
          start: earliestRange.start,
          end: newNextRange.end,
        }))
        .lrem('scannedRanges', -1, earliestRangeString)
        .execAsync();
      } else {
        await $r.lsetAsync('scannedRanges', -1, JSON.stringify({
          start: earliestRange.start,
          end: earliestRange.end + shouldReqCount,
        }));
      }

      this.fillMissingBlocks();
    } else {
      this.fillStopped = true;
    }
  }

  watch({
    coinType,
    receiver, // address
    contract,
    confirmationsRequired = 12,
  }){
    $r.saddAsync('watchList', JSON.stringify({
      coinType: coinType.toUpperCase(),
      receiver: receiver.toLowerCase(),
      contract: contract ? contract.toLowerCase() : undefined,
      confirmationsRequired,
    }));
  }

  async scanETHBlock(blockNumber, callback) {
    const block = await this.web3.eth.getBlock(blockNumber, true);
    const watchList = await $r.smembersAsync('watchList');

    await Promise.all(block.transactions.map((tx) => new Promise(async (resolve) => {
      const { resultTx, watchString } = this.watchTransaction({
        tx,
        timestamp: block.timestamp,
        watchList,
      });

      if (resultTx && watchString) {
        const txReceipt = await this.web3.eth.getTransactionReceipt(resultTx.hash);

        if (txReceipt && txReceipt.status === '0x1') {
          this.incomeCallback(resultTx);
          if (resultTx.confirmations >= resultTx.confirmationsRequired) {          
            $r.sremAsync('watchList', watchString);
          } else {
            $r.multi()
            .sadd('metTxs', JSON.stringify(resultTx))
            .srem('watchList', watchString)
            .execAsync();
          }
        }
      }
      resolve();
    })));

    console.log('scanETHBlock', blockNumber);
    callback();
  }

  watchTransaction({ tx, timestamp, watchList }) {
    const watchResult = {};
    const txSpecialWrapper = timestamp ? {
      timestamp,
      blockNumber: tx.blockNumber,
      confirmations: this.currentBlockNumber - tx.blockNumber,
    } : {};

    if (tx.from) {
      tx.from = tx.from.toLowerCase();
    }
    if (tx.to) {
      tx.to = tx.to.toLowerCase();
    }
    tx.hash = tx.hash.toLowerCase();
    watchList.forEach((watchString) => {
      const watchItem = JSON.parse(watchString);

      if (watchItem.coinType === 'ETH') {
        if (watchItem.receiver === tx.to) {
          watchResult.watchString = watchString;
          watchResult.resultTx = Object.assign({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            coinType: watchItem.coinType,
            value: tx.value,
            confirmationsRequired: watchItem.confirmationsRequired,
          }, txSpecialWrapper);
        }
      } else if (watchItem.coinType === 'ERCTOKEN' && tx.to === watchItem.contract) {
        if (tx.input !== '0x') {
          const inputData = decoder.decodeData(tx.input);

          if (inputData.name === 'transfer') {
            const inputTo = `0x${inputData.inputs[0]}`.toLowerCase();

            if (watchItem.receiver === inputTo) {
              watchResult.watchString = watchString;
              watchResult.resultTx = Object.assign({
                hash: tx.hash,
                from: tx.from,
                to: inputTo,
                coinType: watchItem.coinType,
                value: inputData.inputs[1].toString(10),
                confirmationsRequired: watchItem.confirmationsRequired,
              }, txSpecialWrapper);
            }
          }
        }
      }
    });
    return watchResult;
  }

  async getConfirmations(currentBlockNumber) {
    const metTxs = await $r.smembersAsync('metTxs');

    metTxs.forEach(async (metTxString) => {
      const metTx = JSON.parse(metTxString);
      const txReceipt = await this.web3.eth.getTransactionReceipt(metTx.hash);

      if (txReceipt && txReceipt.status === '0x1') {
        const confirmations = currentBlockNumber - txReceipt.blockNumber + 1;
        const newMetTX = Object.assign({}, metTx, { confirmations });

        this.incomeCallback(newMetTX);
        // console.log('type', typeof confirmations, typeof metTx.confirmationsRequired);
        // console.log('equal', confirmations === metTx.confirmationsRequired);
        if (confirmations >= metTx.confirmationsRequired) {
          console.log('remove!!');
          await $r.sremAsync('metTxs', metTxString);
          console.log('removed!!');
        } else {
          $r.multi()
          .srem('metTxs', metTxString)
          .sadd('metTxs', JSON.stringify(newMetTX))
          .execAsync();
        }
      }
    });
  }
}

const $ci = new CryptoIncome();

$ci.init({
  ETHnet: 'ws://35.194.131.204:8546',
  startBlockNum: 3145525,
  fillingReqQuantity: 20,
  incomeCallback: tx => console.log('mytx', tx),
  pendingCallback: tx => console.log('pending', tx),
});

$ci.watch({
  coinType: 'ETH',
  receiver: '0x9D9A658139B3615CE1C042bD7069E8e025edFC2e',
});

$ci.watch({
  coinType: 'ERCTOKEN',
  receiver: '0xd3DcFc3278fAEdB1B35250eb2953024dE85131e2',
  contract: '0xC9d344dAA04A1cA0fcCBDFdF19DDC674c0648615',
  confirmationsRequired: 7,
});
