# crypto-income
Get incomes from given wallet

## Usage

### Erc20 example:

```javascript
getIncome({
  walletId: '0x7dfdb02a1a......f95c3cc6abb97', // Target wallet
  startBlock: '5283836',
  coinType: 'erc20',
  contractAddr: '0x8B40761142B9aa6dc8964e61D0585995425C3D94', // Tripio's address
  callback: (error, data) => {
    if (!error && !data.empty) {
      console.log('Target wallet got income:', data.totalValue / Math.pow(10, data.decimals) + 'trio'); 
    }
  },
});


> Target wallet got income: 26833.088 trio
```

### Eth example:

```javascript
getIncome({
  walletId: '0x7dfdb02a1a......f95c3cc6abb97', // Target wallet
  startBlock: '5283836',
  coinType: 'eth',
  callback: (error, data) => {
    if (!error && !data.empty) {
      console.log('target wallet got income:', data.totalValue / Math.pow(10, data.decimals) + 'eth'); 
    }
  },
});


> Target wallet got income: 0.31 eth
```



#### Return Value

```javascript
// error object
{ error: 'text' };

// data object
{
  totalValue,
  currentBlock,
  minConfirmations,
  decimals,
  txs: [
    {
      hash, // transaction hash
      from, // sender
      to, // receiver
      value, // the raw value of the coin, you need use decimals to calculate the human readable value for customers.
      blockNumber,
      timeStamp,
      confirmations,
  	},
    ...
  ],
}
```

