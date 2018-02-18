const nodeForge = require('node-forge')

const defaultAttrs = [
    { name: 'countryName', value: 'GB' },
    { name: 'organizationName', value: 'SecApps' },
    { shortName: 'ST', value: 'SA' },
    { shortName: 'OU', value: 'SecApps' }
]

const generateSerialNumber = () => {
    return Math.floor(Math.random() * 100000).toString()
}

const generateGenericKeysAndCert = ({serialNumber=generateSerialNumber(), keyLength=2048}={}) => {
    const keys = nodeForge.pki.rsa.generateKeyPair(keyLength)
    const cert = nodeForge.pki.createCertificate()

    cert.publicKey = keys.publicKey
    cert.serialNumber = serialNumber

    cert.validity.notBefore = new Date()
    cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 10)

    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10)

    return { keys, cert }
}

const generateRootKeysAndCert = ({commonName='RootCA', serialNumber=generateSerialNumber(), keyLength=2048}={}) => {
    const { keys, cert } = generateGenericKeysAndCert({serialNumber, keyLength})

    const attrs = [].concat(defaultAttrs, [
        { name: 'commonName', value: commonName }
    ])

    cert.setSubject(attrs)
    cert.setIssuer(attrs)

    const extensions = [
        { name: 'basicConstraints', cA: true },
        // { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
        // { name: 'extKeyUsage', serverAuth: true, clientAuth: true, codeSigning: true, emailProtection: true, timeStamping: true },
        // { name: 'nsCertType', client: true, server: true, email: true, objsign: true, sslCA: true, emailCA: true, objCA: true },
        // { name: 'subjectKeyIdentifier' }
    ]

    cert.setExtensions(extensions)

    cert.sign(keys.privateKey, nodeForge.md.sha256.create())

    return { keys, cert }
}

const generateHostKeysAndCert = ({domain, rootKeysAndCert, keyLength=2048}={}) => {
    const { keys: rootKeys, cert: rootCert } = rootKeysAndCert

    const serialNumberHash = nodeForge.md.md5.create()

    serialNumberHash.update(domain)

    const serialNumber = serialNumberHash.digest().toHex()

    const { keys, cert } = generateGenericKeysAndCert({serialNumber, keyLength})

    cert.setIssuer(rootCert.subject.attributes)

    const attrs = [].concat(defaultAttrs, [
        { name: 'commonName', value: domain }
    ])

    cert.setSubject(attrs)

    const extensions = [
        { name: 'basicConstraints', cA: false },
        (
            /^\d+?\.\d+?\.\d+?\.\d+?$/.test(domain) ? (
                { name: 'subjectAltName', altNames: [{ type: 7, ip: domain }] }
            ) : (
                { name: 'subjectAltName', altNames: [{ type: 2, value: domain }]}
            )
        )
    ]

    cert.setExtensions(extensions)

    cert.sign(rootKeys.privateKey, nodeForge.md.sha256.create())

    return { keys, cert }
}

const dumpPrivateKey = (keys) => {
    return nodeForge.pki.privateKeyToPem(keys.privateKey)
}

const dumpPublicKey = (keys) => {
    return nodeForge.pki.publicKeyToPem(keys.publicKey)
}

const dumpCertificate = (cert) => {
    return nodeForge.pki.certificateToPem(cert)
}

const loadPrivateKey = (buff) => {
    return nodeForge.pki.privateKeyFromPem(buff.toString())
}

const loadPublicKey = (buff) => {
    return nodeForge.pki.publicKeyFromPem(buff.toString())
}

const loadCertificate = (buff) => {
    return nodeForge.pki.certificateFromPem(buff.toString())
}

module.exports = {
    generateGenericKeysAndCert,
    generateRootKeysAndCert,
    generateHostKeysAndCert,
    dumpPrivateKey,
    dumpPublicKey,
    dumpCertificate,
    loadPrivateKey,
    loadPublicKey,
    loadCertificate
}
