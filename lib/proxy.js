const url = require('url')
const net = require('net')
const http = require('http')
const https = require('https')

const CertManager = require('./cert-manager')
const { dumpPrivateKey, dumpCertificate } = require('./cert-utils')

class Proxy {
    constructor({transports={'http:': http, 'https:': https}, certManager=new CertManager(), connectionHandler}={}) {
        this.transports = transports
        this.certManager = certManager
        this.connectionHandler = connectionHandler

        this.servers = {}

        this.onRequestHandler = this.onRequestHandler.bind(this)
        this.onConnectHandler = this.onConnectHandler.bind(this)
    }

    getConnection(hostname, port, callback) {
        const host = `${hostname}:${port}`

        let next

        if (!this.servers.hasOwnProperty(host)) {
            const { keys, cert } = this.certManager.getHostKeysAndCert(hostname)

            const options = {
                key: dumpPrivateKey(keys),
                cert: dumpCertificate(cert)
            }

            const server = https.createServer(options)

            server.context = {
                protocol: 'https:',
                hostname: hostname,
                port: port,
                host: host
            }

            server.on('request', this.onRequestHandler)

            server.on('close', () => {
                delete this.servers[host]
            })

            next = (c) => server.listen(0, (err) => {
                if (err) {
                    return c(err)
                }

                this.servers[host] = server

                return c(null, server)
            })
        } else {
            next = (c) => c(null, this.servers[host])
        }

        next((err, server) => {
            if (err) {
                return callback(err)
            }

            const socket = new net.Socket()

            socket.on('connect', () => {
                callback(null, socket)
            })

            socket.once('error', (error) => {
                if (error.code !== 'ECONNREFUSED') {
                    callback(error)
                } else {
                    if (process.env.NODE_ENV !== 'production') {
                        console.error(error)
                    }
                }
            })

            socket.connect(server.address().port)
        })
    }

    onRequestHandler(req, res) {
        const options = url.parse(req.url)

        if (req.socket.server.context) {
            Object.assign(options, req.socket.server.context)
        }

        const transport = this.transports[options.protocol]

        if (!transport) {
            if (process.env.NODE_ENV !== 'production') {
                console.error(new Error(`Unknown protocol ${options.protocol}`))
            }

            res.end()

            return
        }

        options.headers = req.headers
        options.method = req.method
        options.agent = false

        const { upstreamTransformer, downstreamTransformer } = (this.connectionHandler || (() => { return {} }))(options)

        if (upstreamTransformer) {
            upstreamTransformer.emit('request', options)
        }

        const connection = transport.request(options)

        connection.on('response', (connectionResponse) => {
            const options = {statusCode: connectionResponse.statusCode, headers: connectionResponse.headers}

            if (downstreamTransformer) {
                downstreamTransformer.emit('response', options)
            }

            res.writeHead(options.statusCode, options.headers)

            connectionResponse.pipe(res, {end: true})
        })

        if (upstreamTransformer) {
            req.pipe(upstreamTransformer).pipe(connection, {end: true})
        } else {
            req.pipe(connection, {end: true})
        }
    }

    onConnectHandler(req, clientSocket, head) {
        const options = url.parse(`https://${req.url}`)

        this.getConnection(options.hostname, options.port, (err, serverSocket) => {
            if (err) {
                if (process.env.NODE_ENV !== 'production') {
                    console.error(err)
                }

                return
            }

            clientSocket.write(`HTTP/1.1 200 Connection Established\r\n\r\n`)
            serverSocket.write(head)

            clientSocket.pipe(serverSocket)
            serverSocket.pipe(clientSocket)

            clientSocket.on('error', () => serverSocket.destroy())
            serverSocket.on('error', () => clientSocket.destroy())
        })
    }

    listen(port, callback) {
        this.server = http.createServer()

        this.server.on('request', this.onRequestHandler)
        this.server.on('connect', this.onConnectHandler)

        return this.server.listen(port, callback)
    }
}

exports.Proxy = Proxy
