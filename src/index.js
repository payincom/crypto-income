import InputDataDecoder from 'ethereum-input-data-decoder';
import Web3 from 'web3';
import { erc20Abi } from './constant';
import { promisifyAll } from 'bluebird';
import redis from 'redis';

const decoder = new InputDataDecoder(erc20Abi);

let $r;

export default class CryptoIncome {
  async init({
    ETHnet, // ws provider addrees
    startBlockNum, // will work at first time
    fillingReqQuantity,
    incomeCallback,
    pendingCallback,
    redisPort,
    redisHost
  }) {
    if (redisPort && redisHost) {
      $r = redis.createClient(redisPort, redisHost);
    } else {
      $r = redis.createClient();
    }

    $r.on('error', function (err) {
      console.log('Error ' + err);
    });

    promisifyAll(redis.RedisClient.prototype);
    promisifyAll(redis.Multi.prototype);

    const originProvider = new Web3.providers.WebsocketProvider(ETHnet);
    this.web3 = new Web3(originProvider);
    const reConnectWhenError = (provider) => {
      provider.on('error', e => console.log('WS Error', e));
      provider.on('end', () => {
        console.log('WS closed');
        const timer = setInterval(() => {
          console.log('Attempting to reconnect...');
          const newProvider = new Web3.providers.WebsocketProvider(ETHnet);

          newProvider.on('connect', () => {
            console.log('WSS Reconnected');
            clearInterval(timer);
            this.web3.setProvider(newProvider);
            reConnectWhenError(newProvider);
          });
        }, 2000);
      });
      this.subscribeNewBlocks();
      this.subscribePendingTx();
    };

    reConnectWhenError(originProvider);
    this.fillingReqQuantity = fillingReqQuantity;
    this.incomeCallback = incomeCallback;
    this.pendingCallback = pendingCallback;
    if (!await $r.lindexAsync('scannedRanges', 0)) {
      console.log('init ranges');
      await $r.lpushAsync('scannedRanges', JSON.stringify({
        start: startBlockNum - 1,
        end: startBlockNum - 1,
      }));
    }
  }

  subscribePendingTx() {
    this.web3.eth.subscribe('pendingTransactions', (error) => {
      if (error) {
        console.log(error);
      }     
    }).on('data', async (txHash) => {
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
        if (this.currentBlockNumber >= blockHeader.number) {
          console.log('desc', this.currentBlockNumber, blockHeader.number);
        }
        this.currentBlockNumber = blockHeader.number;
        this.scanETHBlock(blockHeader.number, async () => {
          if (Number(latestRange.end) + 1 === blockHeader.number) {
            console.log('+++++latest-set', latestRange.start, blockHeader.number);
            $r.watch('scannedRanges');
            $r.lindex('scannedRanges', 0, (err, dataString) => {
              if (err) {
                console.log('err', err);
              }
              let data;
              if (dataString) {
                data = JSON.parse(dataString);
              }
              $r.multi().lset('scannedRanges', 0, JSON.stringify({
                start: data.start,
                end: blockHeader.number,
              }))
              .exec();
            });
          } else if (Number(latestRange.end) === blockHeader.number) {
            console.log('equal======');
            // replace an exsist block, should do nothing   
          } else {
            console.log('add ranges', blockHeader.number);
            await $r.lpushAsync('scannedRanges', JSON.stringify({
              start: blockHeader.number,
              end: blockHeader.number,
            }));
          }
          if (!this.fillStarted) {
            this.fillMissingBlocks();
          }
        });
        this.getConfirmations(blockHeader.number);
      }
    });
  }

  async fillMissingBlocks() {
    this.fillStopped = false;
    this.fillStarted = true;
    const earliestRangeString = await $r.lindexAsync('scannedRanges', -1);
    const earliestRange = JSON.parse(earliestRangeString);
    const nextRangeString = await $r.lindexAsync('scannedRanges', -2);

    if (nextRangeString) {
      const nextRange = JSON.parse(nextRangeString);
      const missingBlockCount = Math.max(nextRange.start - (earliestRange.end + 1), 0);
      const shouldReqCount = Math.min(this.fillingReqQuantity, missingBlockCount);
      await Promise.all(new Array(shouldReqCount).fill(1)
        .map((item, index) => new Promise((resolve) => {
          this.scanETHBlock(earliestRange.end + 1 + index, () => {
            resolve();
          });
        }))
      );

      const newNextRange = JSON.parse(await $r.lindexAsync('scannedRanges', -2));

      if (earliestRange.end + shouldReqCount + 1 === nextRange.start) {
        // After the promise resolved, nextRange could be changed by another functions

        console.log('combine range', earliestRange.start, newNextRange.end);
        await $r.multi()
        .lset('scannedRanges', -2, JSON.stringify({
          start: earliestRange.start,
          end: newNextRange.end,
        }))
        .lrem('scannedRanges', -1, earliestRangeString)
        .execAsync();
      } else if (earliestRange.end + shouldReqCount + 1 > nextRange.start) {
        console.log('combine overflow', earliestRange.start, newNextRange.end);
        await $r.multi()
        .lset('scannedRanges', -2, JSON.stringify({
          start: earliestRange.start,
          end: earliestRange.end,
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
      this.fillStarted = false;
    }
  }

  watch({
    coinType,
    receiver, // address
    contract,
    willExpireIn,
    confirmationsRequired = 12,
  }){
    $r.saddAsync('watchList', JSON.stringify({
      coinType: coinType.toUpperCase(),
      receiver: receiver.toLowerCase(),
      contract: contract ? contract.toLowerCase() : undefined,
      confirmationsRequired,
      willExpireAt: Math.ceil(Date.now() / 1000) + willExpireIn,
    }));
  }

  async scanETHBlock(blockNumber, callback) {
    console.log('blockNumber', blockNumber);
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

        if (txReceipt && txReceipt.status) {
          this.incomeCallback(resultTx);
          if (resultTx.confirmations < resultTx.confirmationsRequired) {
            $r.saddAsync('metTxs', JSON.stringify(resultTx));
          }
        }
      }
      resolve();
    })));

    callback();
  }

  watchTransaction({ tx, timestamp, watchList }) {
    const watchResult = {};
    const txSpecialWrapper = timestamp ? {
      timestamp,
      blockNumber: tx.blockNumber,
      confirmations: this.currentBlockNumber - tx.blockNumber + 1,
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

      if (this.fillStopped && timestamp && watchItem.willExpireAt < timestamp) {
        $r.sremAsync('watchList', watchString);
      }
    });
    return watchResult;
  }

  async getConfirmations(currentBlockNumber) {
    const metTxs = await $r.smembersAsync('metTxs');

    metTxs.forEach(async (metTxString) => {
      const metTx = JSON.parse(metTxString);
      const txReceipt = await this.web3.eth.getTransactionReceipt(metTx.hash);

      if (txReceipt && txReceipt.status) {
        const confirmations = currentBlockNumber - txReceipt.blockNumber + 1;
        const newMetTX = Object.assign({}, metTx, { confirmations });

        this.incomeCallback(newMetTX);
        if (confirmations >= metTx.confirmationsRequired) {
          await $r.sremAsync('metTxs', metTxString);
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

// $ci.init({
//   ETHnet: 'ws://35.201.203.250:8546',
//   startBlockNum: 3303941,
//   fillingReqQuantity: 20,
//   incomeCallback: (tx) => {
//     console.log('income', tx);
//   },
//   pendingCallback: tx => {
//     console.log('tx pending detected', tx);
//   },
//   redisPort: 32771,
//   redisHost: '35.200.86.57',
// });

// $ci.watch({
//   coinType: 'ERCTOKEN',
//   receiver: '0xd3DcFc3278fAEdB1B35250eb2953024dE85131e2',
//   contract: '0xC9d344dAA04A1cA0fcCBDFdF19DDC674c0648615',
//   confirmationsRequired: 2,
//   willExpireIn: 60 * 60,
// });
