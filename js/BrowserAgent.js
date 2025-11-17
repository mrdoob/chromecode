class BrowserAgent {

	constructor( apiKey ) {

		// API key not needed for built-in AI
		this.backgroundPort = null;
		this.isPortConnected = false;
		this.timeout = 60000; // Longer timeout for local model

	}

	setBackgroundPort( port ) {

		this.backgroundPort = port;
		this.isPortConnected = true;

	}

	setPortConnected( connected ) {

		this.isPortConnected = connected;

	}

	async sendMessage( systemPrompt, messages ) {

		if ( !this.backgroundPort || !this.isPortConnected ) {

			throw new Error( 'Not connected to background script' );

		}

		return new Promise( ( resolve, reject ) => {

			const responseHandler = ( message ) => {

				if ( message.type === 'BROWSER_RESPONSE' ) {

					this.backgroundPort.onMessage.removeListener( responseHandler );
					this.backgroundPort.onMessage.removeListener( errorHandler );
					resolve( message.response );

				}

			};

			const errorHandler = ( message ) => {

				if ( message.type === 'ERROR' ) {

					this.backgroundPort.onMessage.removeListener( responseHandler );
					this.backgroundPort.onMessage.removeListener( errorHandler );
					reject( new Error( message.error ) );

				}

			};

			this.backgroundPort.onMessage.addListener( responseHandler );
			this.backgroundPort.onMessage.addListener( errorHandler );

			try {

				this.backgroundPort.postMessage( {
					type: 'CALL_BROWSER',
					systemPrompt: systemPrompt,
					messages: messages
				} );

			} catch ( error ) {

				this.backgroundPort.onMessage.removeListener( responseHandler );
				this.backgroundPort.onMessage.removeListener( errorHandler );
				this.isPortConnected = false;

				if ( error.message.includes( 'disconnected port' ) ) {

					reject( new Error( 'Connection lost. Please try again.' ) );

				} else {

					reject( new Error( 'Failed to send message: ' + error.message ) );

				}

			}

			setTimeout( () => {

				this.backgroundPort.onMessage.removeListener( responseHandler );
				this.backgroundPort.onMessage.removeListener( errorHandler );
				reject( new Error( 'Request timeout' ) );

			}, this.timeout );

		} );

	}

}
