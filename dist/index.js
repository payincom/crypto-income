'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getIncome = getIncome;
exports.getBlockNumber = getBlockNumber;

var _constant = require('./constant');

var _ethereumInputDataDecoder = require('ethereum-input-data-decoder');

var _ethereumInputDataDecoder2 = _interopRequireDefault(_ethereumInputDataDecoder);

var _web = require('web3');

var _web2 = _interopRequireDefault(_web);

var _async = require('async');

var _async2 = _interopRequireDefault(_async);

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var web3 = new _web2.default(new _web2.default.providers.HttpProvider('https://api.myetherapi.com/eth'));

var erc20DecimalsMap = {};

function getIncome(_ref) {
  var walletId = _ref.walletId,
      startBlock = _ref.startBlock,
      coinType = _ref.coinType,
      callback = _ref.callback,
      contractAddr = _ref.contractAddr;

  var contract = void 0;

  if (!walletId || !coinType || !startBlock || !callback) {
    return callback({ error: 'Lack of params' });
  }

  if (coinType === 'erc20') {
    if (!contractAddr) {
      return callback({ error: 'contractAddr is required' });
    }
    contract = new web3.eth.Contract(_constant.erc20Abi, contractAddr);
  }

  _async2.default.waterfall([function (stepCallback) {
    if (coinType === 'erc20' && !erc20DecimalsMap[contractAddr]) {
      contract.methods.decimals().call(function (err, result) {
        if (err) {
          return stepCallback(err);
        }
        erc20DecimalsMap[contractAddr] = Number(result);
        stepCallback();
      });
    } else {
      stepCallback();
    }
  }, function (stepCallback) {
    (0, _request2.default)({
      url: 'https://api.etherscan.io/api?module=account&action=txlist' + ('&address=' + (coinType === 'erc20' ? contractAddr : walletId)) + ('&startblock=' + startBlock + '&endblock=999999999') + '&sort=desc&apikey=AXQE6T8J5F4ZD2QDYWTUJFDSSK5UQUUGSN'
    }, function (err, res, body) {
      if (err) {
        stepCallback(err);
      }
      var bodyObj = JSON.parse(body);
      var rawTxs = bodyObj.result;

      if (rawTxs && rawTxs.length > 0) {

        if (coinType === 'eth') {
          var txs = rawTxs.filter(function (tx) {
            return tx.to.toLowerCase() === walletId.toLowerCase();
          });

          if (txs.length > 0) {
            var totalValue = txs.reduce(function (value, tx) {
              return value + Number(tx.value);
            }, 0);
            var currentBlock = txs[0].blockNumber;
            var minConfirmations = Number(txs[0].confirmations);

            callback(null, {
              totalValue: totalValue,
              currentBlock: currentBlock,
              minConfirmations: minConfirmations,
              decimals: _constant.ethDecimals,
              txs: txs.map(function (tx) {
                return {
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  blockNumber: tx.blockNumber,
                  timeStamp: tx.timeStamp,
                  confirmations: tx.confirmations
                };
              })
            });
          } else {
            callback(null, { empty: true });
          }
        } else if (coinType === 'erc20') {
          var decoder = new _ethereumInputDataDecoder2.default(_constant.erc20Abi);

          var _txs = rawTxs.filter(function (tx) {
            return tx.to.toLowerCase() === contractAddr.toLowerCase();
          }).map(function (tx) {
            var inputData = decoder.decodeData(tx.input);

            return inputData.name === 'transfer' ? {
              hash: tx.hash,
              from: tx.from,
              to: '0x' + inputData.inputs[0],
              value: inputData.inputs[1].toString(10),
              blockNumber: tx.blockNumber,
              timeStamp: tx.timeStamp,
              confirmations: tx.confirmations
            } : null;
          }).filter(function (tx) {
            return tx && tx.to.toLowerCase() === walletId.toLowerCase();
          });

          if (_txs.length > 0) {
            var _totalValue = _txs.reduce(function (value, tx) {
              return value + Number(tx.value);
            }, 0);
            var _currentBlock = _txs[0].blockNumber;
            var _minConfirmations = Number(_txs[0].confirmations);

            callback(null, {
              totalValue: _totalValue,
              currentBlock: _currentBlock,
              minConfirmations: _minConfirmations,
              decimals: erc20DecimalsMap[contractAddr],
              txs: _txs.map(function (tx) {
                return {
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value,
                  blockNumber: tx.blockNumber,
                  timeStamp: tx.timeStamp,
                  confirmations: tx.confirmations
                };
              })
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
  }], function (error) {
    console.log('error', error);
    return getIncome({
      walletId: walletId,
      startBlock: startBlock,
      coinType: coinType,
      callback: callback,
      contractAddr: contractAddr
    });
  });
}

function getBlockNumber() {
  return web3.eth.getBlockNumber();
}