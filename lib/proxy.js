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

    getConnection(options, callback) {
        const socket = new net.Socket()

        socket.on('connect', () => {
            callback(null, socket)
        })

        socket.once('error', (error) => {
            callback(error)
        })

        socket.connect(options)
    }

    getProxyConnection(hostname, port, callback) {
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

            this.getConnection({port: server.address().port}, callback)
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
            filter: 'pipeline',
            pipeline: new Pipeline()
        }

        this.emit('request', requestOptions)

        if (requestOptions.filter === 'deny') {
            res.writeHead(401, 'Unauthorized')
            res.end()

            return
        }

        let next

        if (requestOptions.filter === 'passthrough') {
            next = (c) => c(request)
        } else
        if (requestOptions.filter === 'pipeline') {
            if (requestOptions.pipeline.stream) {
                next = (c) => {
                    requestOptions.pipeline.stream.once('data', (request) => {
                        c(request, requestOptions.pipeline.stream)
                    })

                    requestOptions.pipeline.stream.write(request)
                }
            } else {
                next = (c) => c(request)
            }
        } else {
            throw new Error(`Unrecognized filter ${requestOptions.filter}`)
        }

        next((request, requestPipelineStream) => {
            const connection = transport.request(request)

            connection.on('response', (connectionResponse) => {
                const response = {httpVersion: connectionResponse.httpVersion, statusCode: connectionResponse.statusCode, statusMessage: connectionResponse.statusMessage, headers: connectionResponse.headers}

                const responseOptions = {
                    id: requestOptions.id,
                    response: response,
                    filter: 'pipeline',
                    pipeline: new Pipeline()
                }

                this.emit('response', responseOptions)

                if (responseOptions.filter === 'deny') {
                    res.writeHead(401, 'Unauthorized')
                    res.end()

                    return
                }

                let next

                if (responseOptions.filter === 'passthrough') {
                    next = (c) => c(response)
                } else
                if (responseOptions.filter === 'pipeline') {
                    if (responseOptions.pipeline.stream) {
                        next = (c) => {
                            responseOptions.pipeline.stream.once('data', (response) => {
                                c(response, responseOptions.pipeline.stream)
                            })

                            responseOptions.pipeline.stream.write(response)
                        }
                    } else {
                        next = (c) => c(response)
                    }
                } else {
                    throw new Error(`Unrecognized filter ${responseOptions.filter}`)
                }

                next((response, responsePipelineStream) => {
                    res.writeHead(response.statusCode, response.headers)

                    if (responsePipelineStream) {
                        connectionResponse.pipe(responsePipelineStream).pipe(res, {end: true})
                    } else {
                        connectionResponse.pipe(res, {end: true})
                    }
                })
            })

            if (requestPipelineStream) {
                req.pipe(requestPipelineStream).pipe(connection, {end: true})
            } else {
                req.pipe(connection, {end: true})
            }
        })
    }

    onConnectHandler(req, clientSocket, head) {
        const connect = url.parse(`connect://${req.url}`)

        connect.headers = req.headers
        connect.method = req.method
        connect.httpVersion = req.httpVersion

        const connectOptions = {
            id: this.nextId++,
            connect: connect,
            filter: 'pipeline'
        }

        this.emit('connect', connectOptions)

        if (connectOptions.filter === 'deny') {
            clientSocket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')

            return
        }

        let connectionFunc

        if (connectOptions.filter === 'passthrough') {
            connectionFunc = this.getConnection.bind(this, {host: connect.hostname, port: connect.port})
        } else
        if (connectOptions.filter === 'pipeline') {
            connectionFunc = this.getProxyConnection.bind(this, connect.hostname, connect.port)
        } else {
            throw new Error(`Unrecognized filter ${connectOptions.filter}`)
        }

        connectionFunc((err, serverSocket) => {
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
