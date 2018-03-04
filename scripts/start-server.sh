#!/usr/bin/env node

const { Transform } = require('stream')

const { Proxy } = require('../lib/proxy')
const { CertManager } = require('../lib/cert-manager')
const { CachingCertManagerFs } = require('../lib/cert-manager-fs')
const { generateCaKeysAndCert } = require('../lib/cert-utils')

let certManager

if (process.argv[2]) {
    certManager = new CachingCertManagerFs(process.argv[2])
} else {
    const defaultCaKeysAndCert = generateCaKeysAndCert({commonName: 'Default CA'})

    certManager = new CertManager({defaultCaKeysAndCert})
}

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
            //console.log('>>>', chunk)

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
            //console.log('<<<', chunk)

            callback(null, chunk)
        }
    }))
})

const messages = []

class BroadcastChannel {
    constructor() {
        setTimeout(() => {
            if (this.onmessage) {
                const message = messages.pop()

                const { id, chunks } = message

                const head = chunks[0]
                const body = Buffer.from(Buffer.concat(chunks.slice(1)).toString().replace('123', 'ABC'))

                const event = {data: {id, chunks: [head, body]}}

                this.onmessage(event)
            }
        }, 10000)
    }

    postMessage(message) {
        messages.push(message)
    }
}

class InterceptorStream extends Transform {
    constructor(outChannel, inChannel, id) {
        super({allowHalfOpen: true, readableObjectMode: true, writableObjectMode: true, readableHighWaterMark: Number.MAX_VALUE, writableHighWaterMark: Number.MAX_VALUE})

        this.outChannel = outChannel
        this.inChannel = inChannel

        this.id = id

        this.chunks = []
    }

    _transform(chunk, encoding, callback) {
        this.chunks.push(chunk)

        callback()
    }

    _flush(callback) {
        const bc = new BroadcastChannel(this.outChannel)

        bc.postMessage({id: this.id, chunks: this.chunks})

        this.id = undefined
        this.chunks = undefined

        this.bc = new BroadcastChannel(this.inChannel)

        this.bc.onmessage = (event) => {
            this.bc = undefined

            const { data } = event

            const { chunks } = data

            chunks.forEach((chunk) => {
                this.push(chunk)
            })

            callback()
        }
    }
}

if (process.argv[3] === 'yes') {
    proxy.on('request', (req) => {
        req.filter = 'pipeline'

        req.pipeline.first(new InterceptorStream('b1', 'b2', req.id))
    })
}

if (process.argv[4] === 'yes') {
    proxy.on('response', (res) => {
        res.filter = 'pipeline'

        res.pipeline.first(new InterceptorStream('b1', 'b2', res.id))
    })
}

proxy.listen(process.env.PORT || 8080)
