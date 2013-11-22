module.exports = (grunt) ->
	grunt.initConfig
		coffee:
			compile:
				files: [
					{expand: true, cwd: 'src/bin', src: '*', dest: 'bin/', ext: '', filter: 'isFile'}
					{expand: true, cwd: 'src/lib', src: '*.coffee', dest: 'lib/', ext: '.js', filter: 'isFile'}
				]
		concat:
			options:
				banner: """
				#!/usr/bin/env node
				
				"""
			bin:
				src: ['bin/proxify']
				dest: 'bin/proxify'
		watch:
			src:
				files: ['src/bin/*', 'src/lib/*']
				tasks: ['coffee:compile']
				
	grunt.loadNpmTasks 'grunt-contrib-watch'
	grunt.loadNpmTasks 'grunt-contrib-coffee'
	grunt.loadNpmTasks 'grunt-contrib-concat'
	
	grunt.registerTask 'build', ['coffee:compile', 'concat:bin']
	grunt.registerTask 'default', ['build']
	
