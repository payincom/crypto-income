import { erc20Abi, ethDecimals } from './constant';
import InputDataDecoder from 'ethereum-input-data-decoder';
import Web3 from 'web3';
import async from 'async';
import request from 'request';

const web3_eth = new Web3(
  new Web3.providers.HttpProvider('https://api.myetherapi.com/eth')
);

const web3_rop = new Web3(
  new Web3.providers.HttpProvider('https://api.myetherapi.com/rop')
);


const erc20DecimalsMap = {};

export function getIncome({
  walletId,
  startBlock,
  coinType,
  callback,
  contractAddr,
  test,
}) {
  let contract;

  const web3 = test ? web3_rop : web3_eth;

  if (!walletId || !coinType || !startBlock || !callback) {
    return callback({ error: 'Lack of params' });
  }

  if (coinType === 'erc20') {
    if (!contractAddr) {
      return callback({ error: 'contractAddr is required' });
    }
    contract = new web3.eth.Contract(erc20Abi, contractAddr);
  }

  async.waterfall([
    (stepCallback) => {
      if (coinType === 'erc20' && !erc20DecimalsMap[contractAddr]) {
        contract
        .methods
        .decimals()
        .call((err, result) => {
          if (err) {
            return stepCallback(err);
          }
          erc20DecimalsMap[contractAddr] = Number(result);
          stepCallback();
        });
      } else {
        stepCallback();
      }
    },
    (stepCallback) => {
      request({
        url: `https://api${test ? '-ropsten' : ''}.etherscan.io/api` +
        '?module=account&action=txlist' +
        `&address=${coinType === 'erc20' ? contractAddr : walletId}` +
        `&startblock=${startBlock}&endblock=999999999` +
        '&sort=desc&apikey=AXQE6T8J5F4ZD2QDYWTUJFDSSK5UQUUGSN'
      }, (err, res, body) => {
        if (err) {
          stepCallback(err);
        }
        const bodyObj = JSON.parse(body);
        const rawTxs = bodyObj.result;

        if (rawTxs && rawTxs.length > 0) {

          if (coinType === 'eth') {
            const txs = rawTxs.filter(tx =>
              tx.to.toLowerCase() === walletId.toLowerCase()
            );

            if (txs.length > 0) {
              const totalValue = txs.reduce((value, tx) =>
              value + Number(tx.value), 0);
              const currentBlock = txs[0].blockNumber;
              const minConfirmations = Number(txs[0].confirmations);

              callback(null, {
                totalValue,
                currentBlock,
                minConfirmations,
                decimals: ethDecimals,
                txs: txs.map(tx => ({
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  blockNumber: tx.blockNumber,
                  timeStamp: tx.timeStamp,
                  confirmations: tx.confirmations,
                })),
              });
            } else {
              callback(null, { empty: true });
            }
          } else if (coinType === 'erc20') {
            const decoder = new InputDataDecoder(erc20Abi);

            const txs = rawTxs.filter(tx =>
              tx.to.toLowerCase() === contractAddr.toLowerCase()
            ).map(tx => {
              const inputData = decoder.decodeData(tx.input);

              return inputData.name === 'transfer' ? {
                hash: tx.hash,
                from: tx.from,
                to: `0x${inputData.inputs[0]}`,
                value: inputData.inputs[1].toString(10),
                blockNumber: tx.blockNumber,
                timeStamp: tx.timeStamp,
                confirmations: tx.confirmations,
              } : null;
            })
            .filter(tx => tx && tx.to.toLowerCase() === walletId.toLowerCase());

            if (txs.length > 0) {
              const totalValue = txs.reduce((value, tx) =>
              value + Number(tx.value), 0);
              const currentBlock = txs[0].blockNumber;
              const minConfirmations = Number(txs[0].confirmations);

              callback(null, {
                totalValue,
                currentBlock,
                minConfirmations,
                decimals: erc20DecimalsMap[contractAddr],
                txs: txs.map(tx => ({
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value,
                  blockNumber: tx.blockNumber,
                  timeStamp: tx.timeStamp,
                  confirmations: tx.confirmations,
                })),
              });
            } else {
              callback(null, { empty: true });
            }
          } else {
            callback({ error: 'coinType is not supported' });
          }

        } else {
          callback(null, { empty: true });
        }
      });
    }
  ], error => {
    console.log('error', error);
    return getIncome({
      walletId,
      startBlock,
      coinType,
      callback,
      contractAddr,
      testNet
    });
  });
}

export function getBlockNumber(test) {
  const web3 = test ? web3_rop : web3_eth;
  return web3.eth.getBlockNumber();
}

