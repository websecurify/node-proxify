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

    generateServerKeysAndCert(domain) {
        let caKeysAndCert = this.defaultCaKeysAndCert

        if (this.serverCaKeysAndCert.hasOwnProperty(domain)) {
            caKeysAndCert = this.serverCaKeysAndCert[domain]
        }

        return generateServerKeysAndCert({domain, caKeysAndCert, keyLength: this.keyLength})
    }

    insertServerKeysAndSert(domain, serverKeysAndCert) {
        this.emit('entry', {domain, serverKeysAndCert})

        this.db[domain] = serverKeysAndCert
    }

    getServerKeysAndCert(domain) {
        if (!this.db.hasOwnProperty(domain)) {
            const serverKeysAndCert = this.generateServerKeysAndCert(domain)

            this.emit('entry', {domain, serverKeysAndCert})

            this.db[domain] = serverKeysAndCert
        }

        return this.db[domain]
    }
}

exports.CertManager = CertManager
