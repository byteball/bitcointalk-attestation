const desktopApp = require('byteballcore/desktop_app.js');
const device = require('byteballcore/device.js');
const conf = require('byteballcore/conf');

/**
 * responses for clients
 */
exports.greeting = () => {
	const rewards = Object.keys(conf.listRankRewardsInUsd)
		.map((rank) => {
			return [
				`Rank "${rank}": `,
				`${conf.listRankRewardsInUsd[rank].toLocaleString([], { minimumFractionDigits: 2 })} reward`,
			].join('');
		})
		.join('\n');

	return [
		'Here you can attest your bitcointalk profile.\n\n',

		'Your bitcointalk profile will be linked to your Byteball address, the link can be either made public ',
		'(if you choose so) or saved privately in your wallet. ',
		'In the latter case, only a proof of attestation will be posted publicly on the distributed ledger.\n\n',

		conf.bAllowProofByPayment
			? [
				`The price of attestation is ${conf.priceInBytes / 1e9} GB. `,
				'The payment is nonrefundable even if the attestation fails for any reason.\n\n',
			].join('')
			: '',

		'After you successfully attest your bitcointalk profile for the first time, ',
		'you receive a reward in Bytes that depends on your position in Bitcointalk:\n\n',

		`${rewards}\n\n`,

		'Half of the reward will be immediately available, ',
		'the other half will be locked on a smart contract and can be spent after 1 year.',
	].join('');
};

exports.weHaveReferralProgram = (userAddress) => {
	const inviteCode = `byteball:${device.getMyDevicePubKey()}@${conf.hub}#${userAddress}`;
	const qrUrl = `${conf.webSiteUrl}/qr/?code=${encodeURIComponent(inviteCode)}`;
	const referralRewardContractShareInPercent = conf.referralRewardContractShare * 100;
	return [
		'Remember, we have a referral program: you get rewards by recommending new users to link their ',
		`Bitcointalk and Byteball accounts. There are ${(conf.bAllowProofByPayment ? 4 : 3)} ways to do it `,
		'and ensure that the referrals are tracked to you:\n',

		conf.bAllowProofByPayment
			? [
				'➡ you send Bytes from your attested address to a new user who is not attested yet, ',
				'and he/she uses those Bytes to pay for a successful attestation;\n',
			].join('')
			: '',

		`➡ have new users scan this QR code with wallet app ${qrUrl}, `,
		"which opens this attestation bot in the user's wallet, the wallet has to be already installed;\n",

		'➡ have new users copy-paste this to "Chat > Add a new device > Accept invitation from the other device" ',
		`${inviteCode}, which opens this attestation bot in the user's wallet, the wallet has to be already installed;\n`,

		'➡ have new users click this link (you can publish it e.g. on your blog) ',
		`${conf.webSiteUrl}/${userAddress} which sets a tracking cookie and redirects to wallet download.\n\n`,

		"Your reward is exactly same as the new user's reward. ",
		`${100 - referralRewardContractShareInPercent}% of your reward will be immediately available, `,
		`the other ${referralRewardContractShareInPercent}% will be locked on a smart contract `,
		`and can be spent after ${conf.contractTerm} ${conf.contractTerm === 1 ? 'year' : 'years'}.`,
	].join('');
};

exports.insertMyAddress = () => {
	return [
		'Please send me your address that you wish to attest (click ... and Insert my address).\n',
		'Make sure you are in a single-address wallet. ',
		"If you don't have a single-address wallet, ",
		'please add one (burger menu, add wallet) and fund it with the amount sufficient to pay for the attestation.',
	].join('');
};

exports.goingToAttestAddress = (address) => {
	return `Thanks, going to attest your BB address: ${address}.`;
};

exports.insertBitcointalkProfileLink = () => {
	return [
		'Please send me your Bitcointalk profile summary link.\n',
		'(Example: https://bitcointalk.org/index.php?action=profile;u=412662;sa=summary)',
	].join('');
};

exports.goingToAttestProfile = (btUserId) => {
	return [
		`Thanks, going to attest your bitcointalk profile id: ${btUserId}`,
	].join('');
};

exports.proveProfile = (link) => {
	return [
		`Please insert to your profile this link: ${link}\n`,
		'Then you need to click it, to prove it!\n',
		'Then return to this chat.',
	].join('');
};


exports.privateOrPublic = () => {
	return [
		'Store your bitcointalk profile privately in your wallet or post it publicly?\n\n',
		'[private](command:private)\t[public](command:public)',
	].join('');
};

exports.privateChosen = () => {
	return [
		'Your bitcointalk profile will be kept private and stored in your wallet.\n',
		'Click [public](command:public) now if you changed your mind.',
	].join('');
};

exports.publicChosen = (btUserName, btUserId) => {
	return [
		`Your bitcointalk profile ${btUserName}(${btUserId}) will be posted into the public database `,
		'and will be visible to everyone. You cannot remove it later.\n\n',
		'Click [private](command:private) now if you changed your mind.',
	].join('');
};

exports.pleasePay = (receivingAddress, price, challenge) => {
	if (conf.bAllowProofByPayment) {
		return [
			'Please pay for the attestation: ',
			`[attestation payment](byteball:${receivingAddress}?amount=${price}).\n\n`,
			'Alternatively, you can prove ownership of your address by signing a message: ',
			`[message](sign-message-request:${challenge})`,
			
			conf.signingRewardShare === 1
				? '.'
				: [
					', in this case your attestation reward (if any)',
					` will be ${conf.signingRewardShare * 100}% of the normal reward.`,
				],
		].join('');
	}

	return `Please prove ownership of your address by signing a message: [message](sign-message-request:${challenge}).`;
};

exports.pleasePayOrPrivacy = (receivingAddress, price, challenge, postPublicly) => {
	return (postPublicly === null)
		? exports.privateOrPublic()
		: exports.pleasePay(receivingAddress, price, challenge);
};


exports.receivedAndAcceptedYourPayment = (amount) => {
	return `Received your payment of ${amount / 1e9} GB.`;
};

exports.receivedYourPayment = (amount) => {
	return `Received your payment of ${amount / 1e9} GB, waiting for confirmation. It should take 5-15 minutes.`;
};

exports.alreadAttested = () => {
	return 'You are already attested.';
};

exports.paymentIsConfirmed = () => {
	return 'Your payment is confirmed.';
};


exports.attestedFirstTimeBonus = (
	rewardInUSD, rewardInBytes, contractRewardInBytes, vestingTs, btUserName, btUserId,
) => {
	const contractRewardInUSD = rewardInUSD * conf.rewardContractShare;
	const cashRewardInUSD = rewardInUSD - contractRewardInUSD;
	let text = `You attested your bitcointalk profile ${btUserName}(${btUserId}) for the first time and will receive a welcome bonus of $${cashRewardInUSD.toLocaleString([], { minimumFractionDigits: 2 })} (${(rewardInBytes / 1e9).toLocaleString([], { maximumFractionDigits: 9 })} GB) from Byteball distribution fund.`;
	if (contractRewardInBytes) {
		text += ` You will also receive a reward of $${contractRewardInUSD.toLocaleString([], { minimumFractionDigits: 2 })} (${(contractRewardInBytes / 1e9).toLocaleString([], { maximumFractionDigits: 9 })} GB) that will be locked on a smart contract for ${conf.contractTerm} year and can be spent only after ${new Date(vestingTs).toDateString()}.`;
	}
	return text;
};

exports.referredUserBonus = (
	referralRewardInUSD, referralRewardInBytes, contractReferralRewardInBytes, referrerVestingDateTs,
	btUserName, btUserId,
) => {
	const contractReferralRewardInUSD = referralRewardInUSD * conf.referralRewardContractShare;
	const cashReferralRewardInUSD = referralRewardInUSD - contractReferralRewardInUSD;
	let text = `You referred user ${btUserName}(${btUserId}) who has just verified his bitcointalk profile name and you will receive a reward of $${cashReferralRewardInUSD.toLocaleString([], { minimumFractionDigits: 2 })} (${(referralRewardInBytes / 1e9).toLocaleString([], { maximumFractionDigits: 9 })} GB) from Byteball distribution fund.`;
	if (contractReferralRewardInBytes) {
		text += `  You will also receive a reward of $${contractReferralRewardInUSD.toLocaleString([], { minimumFractionDigits: 2 })} (${(contractReferralRewardInBytes / 1e9).toLocaleString([], { maximumFractionDigits: 9 })} GB) that will be locked on a smart contract for ${conf.contractTerm} year and can be spent only after ${new Date(referrerVestingDateTs).toDateString()}.`;
	}
	text += '\n\nThank you for bringing in a new byteballer, the value of the ecosystem grows with each new user!';
	return text;
};

/**
 * admin responces
 */
exports.listOfReferrals = (rows) => {
	if (!rows.length) {
		return 'Referrals are not found.';
	}
	return [
		'There are referrals:',
		rows.map((row) => {
			return `\n- ${row.bt_user_name}(${row.bt_user_id})`;
		}),
	];
};

/**
 * errors initialize bot
 */
exports.errorInitSql = () => {
	return 'please import db.sql file\n';
};

exports.errorConfigEmail = () => {
	return `please specify admin_email and from_email in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};

exports.errorConfigSalt = () => {
	return `please specify salt in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};
