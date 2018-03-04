const EventEmitter = require('events')

const { generateServerKeysAndCert } = require('./cert-utils')

class CertManager extends EventEmitter {
    constructor({defaultCaKeysAndCert, serverCaKeysAndCert={}, keyLength=2048}={}) {
        super()

        this.defaultCaKeysAndCert = defaultCaKeysAndCert
        this.serverCaKeysAndCert = serverCaKeysAndCert
        this.keyLength = keyLength

        this.db = {}
    }

    generateServerKeysAndCert(hostname) {
        let caKeysAndCert = this.defaultCaKeysAndCert

        if (this.serverCaKeysAndCert.hasOwnProperty(hostname)) {
            caKeysAndCert = this.serverCaKeysAndCert[hostname]
        }

        return generateServerKeysAndCert({commonName: hostname, caKeysAndCert, keyLength: this.keyLength})
    }

    insertServerKeysAndSert(hostname, serverKeysAndCert) {
        this.emit('entry', {hostname, serverKeysAndCert})

        this.db[hostname] = serverKeysAndCert
    }

    getServerKeysAndCert(hostname) {
        if (!this.db.hasOwnProperty(hostname)) {
            const serverKeysAndCert = this.generateServerKeysAndCert(hostname)

            this.emit('entry', {hostname, serverKeysAndCert})

            this.db[hostname] = serverKeysAndCert
        }

        return this.db[hostname]
    }
}

exports.CertManager = CertManager
