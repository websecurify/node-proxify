#!/usr/bin/env node

const { Proxy } = require('../lib/proxy')
const { CertManager } = require('../lib/cert-manager')
const { generateRootKeysAndCert } = require('../lib/cert-utils')

const defaultRootKeysAndCert = generateRootKeysAndCert()

const certManager = new CertManager({defaultRootKeysAndCert})

const proxy = new Proxy({certManager})

proxy.listen(8080)
