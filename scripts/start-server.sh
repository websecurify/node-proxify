#!/usr/bin/env node

const { Transform } = require('stream')

const { Proxy } = require('../lib/proxy')
const { CertManager } = require('../lib/cert-manager')
const { generateRootKeysAndCert } = require('../lib/cert-utils')

const defaultRootKeysAndCert = generateRootKeysAndCert()

const certManager = new CertManager({defaultRootKeysAndCert})

const proxy = new Proxy({certManager})

proxy.on('connect', (con) => {
    if (con.connect.hostname === 'secapps.com') {
        con.filter = 'passthrough'
    } else
    if (con.connect.hostname === 'yahoo.com') {
        con.filter = 'deny'
    } else {
        con.filter = 'pipeline'
    }
})

proxy.on('request', (req) => {
    if (req.request.hostname === 'secapps.com') {
        req.filter = 'passthrough'
    } else
    if (req.request.hostname === 'yahoo.com') {
        req.filter = 'deny'
    } else {
        req.filter = 'pipeline'
    }

    req.pipeline.first(new Transform({
        objectMode: true,

        transform(chunk, encoding, callback) {
            console.log('>>>', chunk)

            callback(null, chunk)
        }
    }))
})

proxy.on('response', (res) => {
    if (res.response.statusCode === 302) {
        res.filter = 'passthrough'
    } else
    if (res.response.statusCode === 404) {
        res.filter = 'deny'
    } else {
        res.filter = 'pipeline'
    }

    res.pipeline.first(new Transform({
        objectMode: true,

        transform(chunk, encoding, callback) {
            console.log('<<<', chunk)

            callback(null, chunk)
        }
    }))
})

proxy.listen(8080)
