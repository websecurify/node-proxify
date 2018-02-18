const EventEmitter = require('events')

const { generateHostKeysAndCert } = require('./cert-utils')

class CertManager extends EventEmitter {
    constructor({defaultRootKeysAndCert, hostRootKeysAndCert={}, keyLength=2048}={}) {
        super()

        this.defaultRootKeysAndCert = defaultRootKeysAndCert
        this.hostRootKeysAndCert = hostRootKeysAndCert
        this.keyLength = keyLength

        this.db = {}
    }

    generateHostKeysAndCert(domain) {
        let rootKeysAndCert = this.defaultRootKeysAndCert

        if (this.hostRootKeysAndCert.hasOwnProperty(domain)) {
            rootKeysAndCert = this.hostRootKeysAndCert[domain]
        }

        return generateHostKeysAndCert({domain, rootKeysAndCert, keyLength: this.keyLength})
    }

    insertHostKeysAndSert(domain, hostKeysAndCert) {
        this.emit('entry', {domain, hostKeysAndCert})

        this.db[domain] = hostKeysAndCert
    }

    getHostKeysAndCert(domain) {
        if (!this.db.hasOwnProperty(domain)) {
            const hostKeysAndCert = this.generateHostKeysAndCert(domain)

            this.emit('entry', {domain, hostKeysAndCert})

            this.db[domain] = hostKeysAndCert
        }

        return this.db[domain]
    }
}

exports.CertManager = CertManager
