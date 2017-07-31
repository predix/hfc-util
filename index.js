'use strict'

var bluebird = require('bluebird')
var hfc = require('hfc')
var fs = require('fs')
var vaultkv = require('vault-hfc-kvstore')
var debug = require('debug')('hfc-util')

var chain
var eventHubUrls
var currentPeerForEventHub = -1

function* setupChain(chainName, caAddr, peers, ehUrls, keystoreLocation, vaultUrl, vaultToken, devMode) {
  chain = hfc.newChain(chainName)
  debug('Adding membership service ', caAddr)
  chain.setMemberServicesUrl('grpc://' + caAddr)
  peers.split(',').forEach(peer => {
    debug('Adding peer ', peer)
    chain.addPeer('grpc://' + peer)
  })
  if (vaultUrl != undefined && vaultToken != undefined) {
    debug('Vault url & token were passed. Using vault: ', vaultUrl)
    var vault = vaultkv.newVaultKeyValStore(vaultUrl, vaultToken)
    chain.setKeyValStore(vault)
  }
  else if (keystoreLocation != undefined) {
    debug('Vault url & token were not passed. Using key store location: ', keystoreLocation)
    var fileKVStore = hfc.newFileKeyValStore(keystoreLocation)
    chain.setKeyValStore(fileKVStore)
  } else {
    debug('Vault or file store location was not specified. Subsequent calls will fail!')
  }
  if (devMode !== undefined) {
    debug('Setting devmode of chain to ', devMode)
    chain.setDevMode(devMode)
  }
  if (ehUrls != undefined) {
    eventHubUrls = ehUrls.split(',')
    yield* connectToEventHub()
  } else {
    debug('No eventHub Urls provided, so not connecting to eventhub')
  }
}

function* connectToEventHub() {
  if (eventHubUrls.length > 0) {
    if (currentPeerForEventHub == -1) {
      debug('This is the initial connection request')
    }
    currentPeerForEventHub++
    if (currentPeerForEventHub >= eventHubUrls.length) {
      debug('All the peers have been tried, starting from beginning again')
      currentPeerForEventHub = 0
    }
    var backoffDuration = 1000
    while (currentPeerForEventHub < eventHubUrls.length) {
      try {
        debug('Setting connected flag to false in Eventhub to allow reconnection to different peer')
        getEventHub().connected = false
        debug('Setting up eventhub connection with ', eventHubUrls[currentPeerForEventHub])
        chain.eventHubConnect('grpc://' + eventHubUrls[currentPeerForEventHub])
        break;
      } catch (err) {
        debug('Error while connecting to eventhub', err)
        debug('Waiting for ', backoffDuration, ' msecs before trying next peer')
        yield delay(backoffDuration)
        backoffDuration = backoffDuration * 2
        currentPeerForEventHub++
      }
    }
  } else {
    debug('No eventHub Urls provided, so not connecting to eventhub')
  }
}

function* getUser(name) {
  var getUser = bluebird.promisify(chain.getUser, {
    context: chain
  })
  var user = yield getUser(name)
  return user
}

function* enrollRegistrar(name, passwd) {
  debug('Entering enrollRegistrar')
  var user = yield* enrollUser(name, passwd)
  chain.setRegistrar(user)
  debug('Successfully enrolled registrar')
  return user
}

function* enrollUser(name, passwd) {
  debug('Entering enrollUser')
  var client = yield* getUser(name)
  debug('Successfully got the user ', name)
  if (client.isEnrolled()) {
    debug('Client', client.getName(), 'is already enrolled')
    return client
  }
  var enroll = bluebird.promisify(client.enroll, {
    context: client
  })
  yield enroll(passwd)
  debug('Successfully enrolled user', name)
  var kvStore = chain.getKeyValStore()
  var getVal = bluebird.promisify(kvStore.getValue, {
    context: kvStore
  })
  try {
    var data = yield getVal('member.' + name)
    debug('Successfully stored client certs')
  } catch (err) {
    throw new Error(err.message)
  }
  return client
}

function getRegistrar() {
  return chain.getRegistrar()
}

function* registerUser(name, affiliation, isRegistrar = false, attrs) {
  debug('Entering registerUser')
  var user = yield* getUser(name)
  var registerUsr = bluebird.promisify(user.register, {
    context: user
  })
  var registrationRequest = {
    enrollmentID: name,
    affiliation: affiliation
  }
  if (isRegistrar) {
    debug('Registering user as registrar')
    registrationRequest.registrar = {
      roles: ['client'],
      delegateRoles: ['client']
    }
  } else {
    registrationRequest.roles = ['client']
  }
  if (attrs !== undefined) {
    registrationRequest.attributes = attrs
  }
  var secret = yield registerUsr(registrationRequest)
  debug('Registered user', name)
  return secret
}

function* getTCert(user, attrs) {
  debug('Getting TCert for user')
  var getTCert = bluebird.promisify(user.getUserCert, {
    context: user
  })
  var cert = yield getTCert(attrs)
  return cert
}

function* deployChaincode(user, args, chaincodePath, attrs = null) {
  debug('Entering deployChaincode')
  var cert = yield* getTCert(user, attrs)
  var deployRequest = {
    chaincodePath: chaincodePath,
    fcn: 'init',
    args: args,
    userCert: cert
  }
  var deployTx = user.deploy(deployRequest)
  debug('Submitted deploy transaction')
  return deployTx
}

function* queryChaincode(user, fn, args, chaincodeID, attrs = null) {
  debug('Entering queryChaincode')
  var queryRequest = {
    chaincodeID: chaincodeID,
    fcn: fn,
    args: args
  }
  if (attrs != null) {
    queryRequest.attrs = attrs
  }
  var queryTx = user.query(queryRequest)
  debug('Submitted query transaction')
  return queryTx
}

function* invokeChaincode(user, fn, args, chaincodeID, attrs = null) {
  debug('Entering invokeChaincode')
  var invokeRequest = {
    chaincodeID: chaincodeID,
    fcn: fn,
    args: args
  }
  if (attrs != null) {
    invokeRequest.attrs = attrs
  }
  var invokeTx = user.invoke(invokeRequest)
  debug('Submitted invoke transaction')
  return invokeTx
}

function setDeployWaitTime(secs) {
  chain.setDeployWaitTime(secs)
}

function setInvokeWaitTime(secs) {
  chain.setInvokeWaitTime(secs)
}

function disconnectEventHub(secs) {
  chain.eventHubDisconnect()
}

function getEventHub() {
  return chain.getEventHub();
}

function isEventHubDisconnectError(e) {
  var isEventHubError = false
  try {
    var o = JSON.parse(e.message)
    if (o.description == 'EOF' && o.grpc_status == 14) {
      isEventHubError = true
    }
  } catch (err) {
    debug('Error message is not JSON:', e.message)
  }
  return isEventHubError
}

module.exports = {
  getRegistrar: getRegistrar,
  setDeployWaitTime: setDeployWaitTime,
  setInvokeWaitTime: setInvokeWaitTime,
  disconnectEventHub: disconnectEventHub,
  getEventHub: getEventHub,
  getUser: bluebird.coroutine(getUser),
  setupChain: bluebird.coroutine(setupChain),
  enrollUser: bluebird.coroutine(enrollUser),
  enrollRegistrar: bluebird.coroutine(enrollRegistrar),
  registerUser: bluebird.coroutine(registerUser),
  deployChaincode: bluebird.coroutine(deployChaincode),
  queryChaincode: bluebird.coroutine(queryChaincode),
  invokeChaincode: bluebird.coroutine(invokeChaincode),
  isEventHubDisconnectError, isEventHubDisconnectError,
  connectToEventHub: bluebird.coroutine(connectToEventHub)
}
