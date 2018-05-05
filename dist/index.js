'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ethereumInputDataDecoder = require('ethereum-input-data-decoder');

var _ethereumInputDataDecoder2 = _interopRequireDefault(_ethereumInputDataDecoder);

var _web = require('web3');

var _web2 = _interopRequireDefault(_web);

var _constant = require('./constant');

var _bluebird = require('bluebird');

var _redis = require('redis');

var _redis2 = _interopRequireDefault(_redis);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var decoder = new _ethereumInputDataDecoder2.default(_constant.erc20Abi);

var $r = _redis2.default.createClient();

$r.on('error', function (err) {
  console.log('Error ' + err);
});

(0, _bluebird.promisifyAll)(_redis2.default.RedisClient.prototype);
(0, _bluebird.promisifyAll)(_redis2.default.Multi.prototype);

var CryptoIncome = function () {
  function CryptoIncome() {
    _classCallCheck(this, CryptoIncome);
  }

  _createClass(CryptoIncome, [{
    key: 'init',
    value: async function init(_ref) {
      var ETHnet = _ref.ETHnet,
          startBlockNum = _ref.startBlockNum,
          fillingReqQuantity = _ref.fillingReqQuantity,
          incomeCallback = _ref.incomeCallback,
          pendingCallback = _ref.pendingCallback;

      this.web3 = new _web2.default(new _web2.default.providers.WebsocketProvider(ETHnet));
      this.fillingReqQuantity = fillingReqQuantity;
      this.incomeCallback = incomeCallback;
      this.pendingCallback = pendingCallback;
      if (!(await $r.lindexAsync('scannedRanges', 0))) {
        await $r.lpushAsync('scannedRanges', JSON.stringify({
          start: startBlockNum - 1,
          end: startBlockNum - 1
        }));
      }
      this.subscribeNewBlocks();
      this.subscribePendingTx();
    }
  }, {
    key: 'subscribePendingTx',
    value: function subscribePendingTx() {
      var _this = this;

      this.web3.eth.subscribe('pendingTransactions', function (error) {
        if (error) {
          console.log(error);
        }
      }).on('data', async function (txHash) {
        var watchList = await $r.smembersAsync('watchList');
        var tx = await _this.web3.eth.getTransaction(txHash);

        if (tx) {
          var _watchTransaction = _this.watchTransaction({
            tx: tx,
            watchList: watchList
          }),
              resultTx = _watchTransaction.resultTx;

          if (resultTx) {
            _this.pendingCallback(resultTx);
          }
        }
      });
    }
  }, {
    key: 'subscribeNewBlocks',
    value: function subscribeNewBlocks() {
      var _this2 = this;

      this.web3.eth.subscribe('newBlockHeaders', function (error) {
        if (error) {
          console.log(error);
        }
      }).on('data', async function (blockHeader) {
        if (blockHeader) {
          var latestRange = JSON.parse((await $r.lindexAsync('scannedRanges', 0)));

          _this2.currentBlockNumber = blockHeader.number;
          _this2.scanETHBlock(blockHeader.number, async function () {
            if (Number(latestRange.end) + 1 === blockHeader.number) {
              $r.lsetAsync('scannedRanges', 0, JSON.stringify({
                start: latestRange.start,
                end: blockHeader.number
              }));
            } else if (Number(latestRange.end) === blockHeader.number) {
              // replace an exsist block, should do nothing   
            } else {
              await $r.lpushAsync('scannedRanges', JSON.stringify({
                start: blockHeader.number,
                end: blockHeader.number
              }));
              if (!_this2.fillStarted) {
                _this2.fillMissingBlocks();
              }
            }
          });
          _this2.getConfirmations(blockHeader.number);
        }
      });
    }
  }, {
    key: 'fillMissingBlocks',
    value: async function fillMissingBlocks() {
      var _this3 = this;

      this.fillStopped = false;
      this.fillStarted = true;
      var earliestRangeString = await $r.lindexAsync('scannedRanges', -1);
      var earliestRange = JSON.parse(earliestRangeString);
      var nextRangeString = await $r.lindexAsync('scannedRanges', -2);

      if (nextRangeString) {
        var nextRange = JSON.parse(nextRangeString);
        var missingBlockCount = nextRange.start - (earliestRange.end + 1);
        var shouldReqCount = Math.min(this.fillingReqQuantity, missingBlockCount);

        await Promise.all(new Array(shouldReqCount).fill(1).map(function (item, index) {
          return new Promise(function (resolve) {
            _this3.scanETHBlock(earliestRange.end + 1 + index, function () {
              resolve();
            });
          });
        }));

        if (earliestRange.end + shouldReqCount + 1 === nextRange.start) {
          // After the promise resolved, nextRange could be changed by another functions
          var newNextRange = JSON.parse((await $r.lindexAsync('scannedRanges', -2)));

          await $r.multi().lset('scannedRanges', -2, JSON.stringify({
            start: earliestRange.start,
            end: newNextRange.end
          })).lrem('scannedRanges', -1, earliestRangeString).execAsync();
        } else {
          await $r.lsetAsync('scannedRanges', -1, JSON.stringify({
            start: earliestRange.start,
            end: earliestRange.end + shouldReqCount
          }));
        }

        this.fillMissingBlocks();
      } else {
        this.fillStopped = true;
        this.fillStarted = false;
      }
    }
  }, {
    key: 'watch',
    value: function watch(_ref2) {
      var coinType = _ref2.coinType,
          receiver = _ref2.receiver,
          contract = _ref2.contract,
          willExpireIn = _ref2.willExpireIn,
          _ref2$confirmationsRe = _ref2.confirmationsRequired,
          confirmationsRequired = _ref2$confirmationsRe === undefined ? 12 : _ref2$confirmationsRe;

      $r.saddAsync('watchList', JSON.stringify({
        coinType: coinType.toUpperCase(),
        receiver: receiver.toLowerCase(),
        contract: contract ? contract.toLowerCase() : undefined,
        confirmationsRequired: confirmationsRequired,
        willExpireAt: Math.ceil(Date.now() / 1000) + willExpireIn
      }));
    }
  }, {
    key: 'scanETHBlock',
    value: async function scanETHBlock(blockNumber, callback) {
      var _this4 = this;

      var block = await this.web3.eth.getBlock(blockNumber, true);
      var watchList = await $r.smembersAsync('watchList');

      await Promise.all(block.transactions.map(function (tx) {
        return new Promise(async function (resolve) {
          var _watchTransaction2 = _this4.watchTransaction({
            tx: tx,
            timestamp: block.timestamp,
            watchList: watchList
          }),
              resultTx = _watchTransaction2.resultTx,
              watchString = _watchTransaction2.watchString;

          if (resultTx && watchString) {
            var txReceipt = await _this4.web3.eth.getTransactionReceipt(resultTx.hash);

            if (txReceipt && txReceipt.status) {
              _this4.incomeCallback(resultTx);
              if (resultTx.confirmations < resultTx.confirmationsRequired) {
                $r.saddAsync('metTxs', JSON.stringify(resultTx));
              }
            }
          }
          resolve();
        });
      }));

      callback();
    }
  }, {
    key: 'watchTransaction',
    value: function watchTransaction(_ref3) {
      var _this5 = this;

      var tx = _ref3.tx,
          timestamp = _ref3.timestamp,
          watchList = _ref3.watchList;

      var watchResult = {};
      var txSpecialWrapper = timestamp ? {
        timestamp: timestamp,
        blockNumber: tx.blockNumber,
        confirmations: this.currentBlockNumber - tx.blockNumber + 1
      } : {};

      if (tx.from) {
        tx.from = tx.from.toLowerCase();
      }
      if (tx.to) {
        tx.to = tx.to.toLowerCase();
      }
      tx.hash = tx.hash.toLowerCase();

      watchList.forEach(function (watchString) {
        var watchItem = JSON.parse(watchString);

        if (watchItem.coinType === 'ETH') {
          if (watchItem.receiver === tx.to) {
            watchResult.watchString = watchString;
            watchResult.resultTx = Object.assign({
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              coinType: watchItem.coinType,
              value: tx.value,
              confirmationsRequired: watchItem.confirmationsRequired
            }, txSpecialWrapper);
          }
        } else if (watchItem.coinType === 'ERCTOKEN' && tx.to === watchItem.contract) {
          if (tx.input !== '0x') {
            var inputData = decoder.decodeData(tx.input);

            if (inputData.name === 'transfer') {
              var inputTo = ('0x' + inputData.inputs[0]).toLowerCase();

              if (watchItem.receiver === inputTo) {
                watchResult.watchString = watchString;
                watchResult.resultTx = Object.assign({
                  hash: tx.hash,
                  from: tx.from,
                  to: inputTo,
                  coinType: watchItem.coinType,
                  value: inputData.inputs[1].toString(10),
                  confirmationsRequired: watchItem.confirmationsRequired
                }, txSpecialWrapper);
              }
            }
          }
        }

        if (_this5.fillStopped && timestamp && watchItem.willExpireAt < timestamp) {
          $r.sremAsync('watchList', watchString);
        }
      });
      return watchResult;
    }
  }, {
    key: 'getConfirmations',
    value: async function getConfirmations(currentBlockNumber) {
      var _this6 = this;

      var metTxs = await $r.smembersAsync('metTxs');

      metTxs.forEach(async function (metTxString) {
        var metTx = JSON.parse(metTxString);
        var txReceipt = await _this6.web3.eth.getTransactionReceipt(metTx.hash);

        if (txReceipt && txReceipt.status) {
          var confirmations = currentBlockNumber - txReceipt.blockNumber + 1;
          var newMetTX = Object.assign({}, metTx, { confirmations: confirmations });

          _this6.incomeCallback(newMetTX);
          if (confirmations >= metTx.confirmationsRequired) {
            await $r.sremAsync('metTxs', metTxString);
          } else {
            $r.multi().srem('metTxs', metTxString).sadd('metTxs', JSON.stringify(newMetTX)).execAsync();
          }
        }
      });
    }
  }]);

  return CryptoIncome;
}();

exports.default = CryptoIncome;