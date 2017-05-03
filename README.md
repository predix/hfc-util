# Hyperledger Fabric Util
This module provides wrapper functions for interacting with hyperledger fabric using (hfc)[https://www.npmjs.com/package/hfc] node module.

## Usage
1. Install node module
    ```
    npm install hfc-util
    ```
1. Import the module
    ```
    var hfcUtil = require('hfc-util');
    ```
1. Invoke methods exposed by the module
    ```
    hfcUtil.setupChain('mychain', <membership addr>, <comma separated peer addr>, [<key value store folder location>], [<vault url>], [<vault token>]);
    hfcUtil.enrollRegistrar('registrar','registrarPassword');
    ```