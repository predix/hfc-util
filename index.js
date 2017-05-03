'use strict';

var bluebird = require('bluebird');
var hfc = require('hfc');
var fs = require('fs');
var vaultkv = require('vault-hfc-kvstore');
var debug = require('debug')('hfc-util');

var chain;

function* setupChain(chainName, caAddr, peers, keystoreLocation, vaultUrl, vaultToken) {
    chain = hfc.newChain(chainName);
    debug("Adding membership service ", caAddr);
    chain.setMemberServicesUrl("grpc://" + caAddr);
    peers.split(",").forEach(peer => {
        debug("Adding peer ", peer);
        chain.addPeer("grpc://" + peer);
    });
    if (vaultUrl != undefined && vaultToken != undefined) {
        debug("Vault url & token were passed. Using vault: ", vaultUrl);
        var vault = vaultkv.newVaultKeyValStore(vaultUrl, vaultToken);
        chain.setKeyValStore(vault);
    }
    else if (keystoreLocation != undefined) {
        debug("Vault url & token were not passed. Using key store location: ", keystoreLocation);
        var fileKVStore = hfc.newFileKeyValStore(keystoreLocation);
        chain.setKeyValStore(fileKVStore);
    } else {
        debug("Vault or file store location was not specified. Subsequent calls will fail!");
    }
}

function* getUser(name) {
    var getUser = bluebird.promisify(chain.getUser, {
        context: chain
    });
    var user = yield getUser(name);
    return user;
}

function* enrollRegistrar(name, passwd) {
    debug("Entering enrollRegistrar");
    var user = yield* enrollUser(name, passwd);
    chain.setRegistrar(user);
    debug("Successfully enrolled registrar");
    return user;
}

function* enrollUser(name, passwd) {
    debug("Entering enrollUser");
    var client = yield* getUser(name);
    debug("Successfully got the user ", name);
    if (client.isEnrolled()) {
        debug("Client", client.getName(), "is already enrolled");
        return client;
    }
    var enroll = bluebird.promisify(client.enroll, {
        context: client
    });
    yield enroll(passwd);
    debug("Successfully enrolled user", name);
    var kvStore = chain.getKeyValStore();
    var getVal = bluebird.promisify(kvStore.getValue, {
        context: kvStore
    });
    try {
        var data = yield getVal('member.' + name)
        debug("Successfully stored client certs");
    } catch (err) {
        throw new Error(err.message);
    }
    return client
}

function getRegistrar() {
    return chain.getRegistrar();
}

function* registerUser(name, affiliation) {
    debug("Entering registerUser");
    var user = yield* getUser(name);
    var registerUsr = bluebird.promisify(user.register, {
        context: user
    });
    var registrationRequest = {
        enrollmentID: name,
        affiliation: affiliation
    };
    var secret = yield registerUsr(registrationRequest);
    debug("Registered user", name);
    return secret;
}

function* deployChaincode(user, args, chaincodePath) {
    debug("Entering deployChaincode");
    var deployRequest = {
        chaincodePath: chaincodePath,
        fcn: "init",
        args: args
    }
    var deployTx = user.deploy(deployRequest);
    debug("Submitted deploy transaction");
    return deployTx;
}

function* queryChaincode(user, args, chaincodeID) {
    debug("Entering queryChaincode");
    var queryRequest = {
        chaincodeID: chaincodeID,
        fcn: "query",
        args: args
    }
    var queryTx = user.query(queryRequest);
    debug("Submitted query transaction");
    return queryTx;
}

function* invokeChaincode(user, fn, args, chaincodeID) {
    debug("Entering invokeChaincode");
    var invokeRequest = {
        chaincodeID: chaincodeID,
        fcn: fn,
        args: args
    }
    var invokeTx = user.invoke(invokeRequest);
    debug("Submitted invoke transaction");
    return invokeTx;
}

module.exports = {
    getRegistrar: getRegistrar,
    getUser: bluebird.coroutine(getUser),
    setupChain: bluebird.coroutine(setupChain),
    enrollUser: bluebird.coroutine(enrollUser),
    enrollRegistrar: bluebird.coroutine(enrollRegistrar),
    registerUser: bluebird.coroutine(registerUser),
    deployChaincode: bluebird.coroutine(deployChaincode),
    queryChaincode: bluebird.coroutine(queryChaincode),
    invokeChaincode: bluebird.coroutine(invokeChaincode)
}