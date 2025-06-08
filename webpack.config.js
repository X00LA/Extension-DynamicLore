const path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist'),
        library: {
            type: 'module'
        }
    },
    experiments: {
        outputModule: true
    },
    resolve: {
        fallback: {
            "fs": false,
            "http": false,
            "https": false,
            "url": false,
            "path": false,
            "stream": false,
            "crypto": false,
            "zlib": false
        }
    },
    externals: {
        '../../../../scripts/extensions.js': 'extensions',
        '../../../../scripts/world-info.js': 'world-info',
        '../../../../scripts/slash-commands.js': 'slash-commands'
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env']
                    }
                }
            }
        ]
    }
};
