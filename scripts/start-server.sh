#!/usr/bin/env node

const { Transform } = require('stream')

const { Proxy } = require('../lib/proxy')
const { CertManager } = require('../lib/cert-manager')
const { generateRootKeysAndCert } = require('../lib/cert-utils')

const defaultRootKeysAndCert = generateRootKeysAndCert()

const certManager = new CertManager({defaultRootKeysAndCert})

const proxy = new Proxy({certManager})

proxy.on('request', (req) => {
    req.pipeline.first(new Transform({
        objectMode: true,

        transform(chunk, encoding, callback) {
            console.log('>>>', chunk)

            callback(null, chunk)
        }
    }))
})

proxy.on('response', (res) => {
    res.pipeline.first(new Transform({
        objectMode: true,

        transform(chunk, encoding, callback) {
            console.log('<<<', chunk)

            callback(null, chunk)
        }
    }))
})

proxy.listen(8080)
