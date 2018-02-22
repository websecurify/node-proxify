class Pipeline {
    last(transformer, options) {
        if (this.stream) {
            this.stream = this.stream.pipe(transformer, options)
        } else {
            this.stream = transformer
        }
    }

    first(transformer, options) {
        if (this.stream) {
            transformer.pipe(this.stream, options)

            this.stream = transformer
        } else {
            this.stream = transformer
        }
    }
}

exports.Pipeline = Pipeline
