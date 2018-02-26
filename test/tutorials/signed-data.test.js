/**
 * at this tests, we run the code which is used in the tutorials
 * to ensure they work as expected
 */

const ganache = require('ganache-cli');
const Web3 = require('web3');
const AsyncTestUtil = require('async-test-util');
const assert = require('assert');
const EthCrypto = require('../../dist/lib/index');
const compiledDonationBag = require('../../gen/DonationBag.json');

describe('signed-data.md', () => {
    it('all', async function() {
        this.timeout(12000);
        const creatorIdentity = EthCrypto.createIdentity();
        const recieverIdentity = EthCrypto.createIdentity();
        const web3 = new Web3();
        const ganacheProvider = ganache.provider({
            accounts: [
                // we preset the balance of our identity to 10 ether
                {
                    secretKey: creatorIdentity.privateKey,
                    balance: web3.utils.toWei('10', 'ether')
                },
                // we also give some wei to the recieverIdentity
                // so it can send transaction to the chain
                {
                    secretKey: recieverIdentity.privateKey,
                    balance: web3.utils.toWei('1', 'ether')
                }
            ]
        });
        web3.setProvider(ganacheProvider);


        let compiled;
        const fastMode = true; // TODO check in config if really fast-mode
        if (!fastMode) {
            const solc = require('solc');
            const fs = require('fs');
            const path = require('path');
            const contractPath = path.join(__dirname, '../../contracts/DonationBag.sol');

            // read solidity-code from file
            const contractCode = fs.readFileSync(contractPath, 'utf8');

            // compile the code into an object
            compiled = solc.compile(contractCode, 1).contracts[':DonationBag'];

        } else {
            compiled = require('../../gen/DonationBag.json');
            compiled.bytecode = compiled.code;
            compiled.interface = JSON.stringify(compiled.interface);
        }

        const createCode = EthCrypto.txDataByCompiled(
            compiled.interface, // abi
            compiled.bytecode, // bytecode
            [creatorIdentity.address] // constructor-arguments
        );


        // create create-tx
        const rawTx = {
            from: creatorIdentity.address,
            nonce: 0,
            gasLimit: 5000000,
            gasPrice: 5000000000,
            data: createCode
        };
        const serializedTx = EthCrypto.signTransaction(
            rawTx,
            creatorIdentity.privateKey
        );

        // submit
        const receipt = await web3.eth.sendSignedTransaction(serializedTx);
        const contractAddress = receipt.contractAddress;
        // console.log('contractAddress: ' + contractAddress);
        // console.log('creator address: ' + creatorIdentity.address);

        assert.ok(receipt.contractAddress);
        assert.equal(receipt.status, 1);

        // create contract instance
        // console.log('# create contract instance');
        const contractInstance = new web3.eth.Contract(
            JSON.parse(compiled.interface),
            contractAddress
        );

        // check owner
        // console.log('# check owner');
        const owner = await contractInstance.methods.owner().call();
        assert.equal(owner, creatorIdentity.address);

        // send value
        // console.log('#send value:');
        const rawTx2 = {
            from: creatorIdentity.address,
            to: contractAddress,
            nonce: 1,
            value: parseInt(web3.utils.toWei('3', 'ether')),
            gas: 600000,
            gasPrice: 20000000000
        };
        const serializedTx2 = EthCrypto.signTransaction(
            rawTx2,
            creatorIdentity.privateKey
        );
        await web3.eth.sendSignedTransaction(serializedTx2);

        // check balance
        const balance = await contractInstance.methods.getBalance().call();
        assert.equal(balance, web3.utils.toWei('3', 'ether'));

        // check prefixedHash
        const solHash = await contractInstance
            .methods
            .prefixedHash(recieverIdentity.address)
            .call();
        // console.log('solHash: ' + solHash);

        // sign message
        const signHash = EthCrypto.hash.keccak256([{
            type: 'string',
            value: 'Signed for DonationBag:'
        }, {
            type: 'address',
            value: contractAddress
        }, {
            type: 'address',
            value: recieverIdentity.address
        }]);
        assert.equal(signHash, solHash);

        const signature = EthCrypto.sign(
            creatorIdentity.privateKey,
            signHash
        );
        const vrs = EthCrypto.vrs.fromString(signature);
        const isValid = await contractInstance
            .methods.isSignatureValid(
                recieverIdentity.address,
                vrs.v,
                vrs.r,
                vrs.s
            ).call();
        assert.ok(isValid);

        // claim donation by receiver
        const recieveCode = contractInstance
            .methods.recieveDonation(
                vrs.v,
                vrs.r,
                vrs.s
            ).encodeABI();
        const recieveTx = {
            from: recieverIdentity.address,
            to: contractAddress,
            nonce: 0,
            gasLimit: 5000000,
            gasPrice: 5000000000,
            data: recieveCode
        };
        const serializedRecieveTx = EthCrypto.signTransaction(
            recieveTx,
            recieverIdentity.privateKey
        );
        const receipt3 = await web3.eth.sendSignedTransaction(serializedRecieveTx);

        // check receiver-balance
        const receiverBalance = await web3.eth.getBalance(recieverIdentity.address);
        // 1999802840000000000
        assert.ok(parseInt(receiverBalance) > parseInt(web3.utils.toWei('1', 'ether')));
    });
});
