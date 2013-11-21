fs = require 'fs'

url = require 'url'
net = require 'net'
http = require 'http'
https = require 'https'

# ---

exports.create_bare_proxy = (srv_imp=http, config=null) ->
	proxy = srv_imp.createServer(config)
	
	# +++
	
	proxy.on 'request', (req, res) ->
		req.pause()
		
		# ^^^
		
		options = url.parse req.url
		options.headers = req.headers
		options.method = req.method
		options.agent = false
		
		# ^^^
		
		if config
			options.protocol ?= config.overwrite_protocol
			options.hostname ?= config.overwrite_hostname
			options.port ?= config.overwrite_port
			
		# ^^^
		
		clt_imp = switch
			when options.protocol == 'http:' then http
			when options.protocol == 'https:' then https
			else http
			
		# ^^^
		
		connector = clt_imp.request options, (server_res) ->
			server_res.pause()
			
			# ~~~
			
			res.writeHeader(server_res.statusCode, server_res.headers)
			
			# ~~~
			
			server_res.pipe(res)
			server_res.resume()
			
		# ^^^
		
		req.on 'error', () ->
		connector.on 'error', () ->
		
		# +++
		
		req.pipe(connector)
		req.resume()
		
	# +++
	
	return proxy
	
# ---

exports.pem_manager = new class
	constructor: () ->
		@pems = {}
		
	get: (hostname, port, callback) ->
		netloc = "#{hostname}:#{port}"
		
		# +++
		
		return callback null, @pems[netloc] if @pems[netloc]?
		
		# +++
		
		pem = {
			key: fs.readFileSync('server-key.pem')
			cert: fs.readFileSync('server-cert.pem')
		}
		
		# +++
		
		@pems[netloc] = pem
		
		# +++
		
		return callback null, pem
		
# ---

exports.connection_manager = new class
	constructor: () ->
		@connections = {}
		@port = 1337
		
	get: (hostname, port, callback) ->
		netloc = "#{hostname}:#{port}"
		
		# +++
		
		return callback null, @connections[netloc] if @connections[netloc]?
		
		# +++
		
		exports.pem_manager.get hostname, port, (err, pem) =>
			return err if err
			
			# ^^^
			
			connection = {
				server_port: ++@port
				server: exports.create_bare_proxy https, {
					overwrite_protocol: 'https:'
					overwrite_hostname: hostname
					overwrite_port: port
					key: pem.key
					cert: pem.cert
				}
			}
			
			# ^^^
			
			@connections[netloc] = connection
			
			# ^^^
			
			connection.server.listen connection.server_port, () -> callback null, connection
			
# ---

exports.create_proxy = (options={}) ->
	proxy = exports.create_bare_proxy()
	
	# +++
	
	proxy.on 'connect', (req, clt_socket, head) ->
		options = url.parse "https://#{req.url}"
		
		# ^^
		
		exports.connection_manager.get options.hostname, options.port, (err, connection) ->
			clt_socket.destroy() if err
			
			# ~~~
			
			srv_socket = net.connect connection.server_port, 'localhost', () ->
				clt_socket.write "HTTP/1.1 200 Connection Established\r\nProxy-agent: #{options.agent ? 'Proxify'}\r\n\r\n"
				srv_socket.write head
				
				# ~~~
				
				clt_socket.pipe srv_socket
				srv_socket.pipe clt_socket
				
			# ~~~
			
			clt_socket.on 'error', () -> srv_socket.destroy()
			srv_socket.on 'error', () -> clt_socket.destroy()
			
	# +++
	
	return proxy
	
