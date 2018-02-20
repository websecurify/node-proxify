const url = require('url')
const net = require('net')
const http = require('http')
const https = require('https')
const EventsEmitter = require('events')

const { Pipeline } = require('./pipeline')
const { CertManager } = require('./cert-manager')
const { dumpPrivateKey, dumpCertificate } = require('./cert-utils')

class Proxy extends EventsEmitter {
    constructor({transports={'http:': http, 'https:': https}, certManager=new CertManager()}={}) {
        super()

        this.transports = transports
        this.certManager = certManager

        this.servers = {}

        this.nextId = 0

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
        const request = url.parse(req.url)

        if (req.socket.server.context) {
            Object.assign(request, req.socket.server.context)
        }

        const transport = this.transports[request.protocol]

        if (!transport) {
            if (process.env.NODE_ENV !== 'production') {
                console.error(new Error(`Unknown protocol ${request.protocol}`))
            }

            res.end()

            return
        }

        request.headers = req.headers
        request.method = req.method
        request.httpVersion = req.httpVersion

        const requestOptions = {
            id: this.nextId++,
            request: request,
            pipeline: new Pipeline()
        }

        this.emit('request', requestOptions)

        let next

        if (requestOptions.pipeline.stream) {
            next = (c) => {
                requestOptions.pipeline.stream.once('data', (request) => {
                    c(request)
                })

                requestOptions.pipeline.stream.write(request)
            }
        } else {
            next = (c) => c(request)
        }

        next((request) => {
            const connection = transport.request(request)

            connection.on('response', (connectionResponse) => {
                const response = {httpVersion: connectionResponse.httpVersion, statusCode: connectionResponse.statusCode, statusMessage: connectionResponse.statusMessage, headers: connectionResponse.headers}

                const responseOptions = {
                    id: requestOptions.id,
                    response: response,
                    pipeline: new Pipeline()
                }

                this.emit('response', responseOptions)

                let next

                if (responseOptions.pipeline.stream) {
                    next = (c) => {
                        responseOptions.pipeline.stream.once('data', (response) => {
                            c(response)
                        })

                        responseOptions.pipeline.stream.write(response)
                    }
                } else {
                    next = (c) => c(response)
                }

                next((response) => {
                    res.writeHead(response.statusCode, response.headers)

                    if (responseOptions.pipeline.stream) {
                        connectionResponse.pipe(responseOptions.pipeline.stream).pipe(res, {end: true})
                    } else {
                        connectionResponse.pipe(res, {end: true})
                    }
                })
            })

            if (requestOptions.pipeline.stream) {
                req.pipe(requestOptions.pipeline.stream).pipe(connection, {end: true})
            } else {
                req.pipe(connection, {end: true})
            }
        })
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

    close(callback) {
        Promise.all([this.server].concat(Object.values(this.servers)).map((server) => {
            return new Promise((resolve) => {
                server.close(() => resolve())
            }) 
        }))
        .then(() => {
            if (callback) {
                callback()
            }
        })
    }
}

exports.Proxy = Proxy
