# crypto-income
Get incomes from given wallet

## Environment

Install redis and start at localhost with default configurations.



## Get Income

### Example:

```javascript
import CryptoIncome from 'rollingminds/crypto-income';

const $ci = new CryptoIncome();

$ci.init({
  ETHnet: 'ws://xxxx:8546',
  startBlockNum: 3156827,
  fillingReqQuantity: 20,
  incomeCallback: tx => console.log('mytx', tx),
  pendingCallback: tx => console.log('pending', tx),
});

// Add ETH income watcher
$ci.watch({
  coinType: 'ETH',
  receiver: '0x9D9A658139B3615CE1C042bD7069E8e025edFC2e',
});

// Add ERCTOKEN income watcher
$ci.watch({
  coinType: 'ERCTOKEN',
  receiver: '0xd3DcFc3278fAEdB1B35250eb2953024dE85131e2',
  contract: '0xC9d344dAA04A1cA0fcCBDFdF19DDC674c0648615',
  confirmationsRequired: 7, // default is 12
});
```



### Callback value:

```javascript
// incomeCallback parameter
tx = {
  hash: '0x91165c77b01f1549844f44a0a552b10df1ea15db02b8eb0f1f793d94690cd1c6',
  from: '0x9d9a658139b3615ce1c042bd7069e8e025edfc2e',
  to: '0xd3dcfc3278faedb1b35250eb2953024de85131e2',
  coinType: 'ETH',
  value: '123000000000000000000',
  blockNumber: 3156848,
  timestamp: 1525297300,
  confirmations: 6,
  confirmationsRequired: 12,
};

// pendingCallback parameter
tx = {
  hash: '0x91165c77b01f1549844f44a0a552b10df1ea15db02b8eb0f1f793d94690cd1c6',
  from: '0x9d9a658139b3615ce1c042bd7069e8e025edfc2e',
  to: '0xd3dcfc3278faedb1b35250eb2953024de85131e2',
  coinType: 'ETH',
  value: '123000000000000000000',
  confirmationsRequired: 12,
};
```



