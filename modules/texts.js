// const desktopApp = require('byteballcore/desktop_app.js');
const conf = require('byteballcore/conf');

/**
 * responses for clients
 */
exports.greeting = () => {
  const rewards = conf.arrReputationRewardsInUsd
    .map((bracket) => {
      return `Reputation ${bracket.threshold} or above: ${bracket.rewardInUsd.toLocaleString([], { minimumFractionDigits: 2 })} reward`;
    })
    .join('\n');
  return [
    'Here you can attest your steem username.\n\n',

    'Your steem username will be linked to your Byteball address, the link can be either made public (if you choose so) or saved privately in your wallet. ',
    'In the latter case, only a proof of attestation will be posted publicly on the distributed ledger. ',
    '\n\n',

    conf.bAllowProofByPayment ? `The price of attestation is ${conf.priceInBytes/1e9} GB.  The payment is nonrefundable even if the attestation fails for any reason.\n\n` : '',

    `After you successfully attest your steem username for the first time, `,
    `you receive a reward in Bytes that depends on your reputation in Steem:\n\n${rewards}\n\nHalf of the reward will be immediately available, the other half will be locked on a smart contract and can be spent after 1 year.`
  ].join('');
};
