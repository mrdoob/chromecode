class BrowserAgent {

	constructor( apiKey ) {

		// API key not needed for built-in AI
		this.session = null;
		this.timeout = 60000; // Longer timeout for local model

	}

	setBackgroundPort( port ) {

		// Not needed for built-in AI

	}

	setPortConnected( connected ) {

		// Not needed for built-in AI

	}

	async sendMessage( systemPrompt, messages ) {

		// Check if Prompt API is available
		if ( typeof LanguageModel === 'undefined' ) {

			throw new Error( 'Built-in AI not available. Enable chrome://flags/#prompt-api-for-gemini-nano' );

		}

		const availability = await LanguageModel.availability();

		if ( availability === 'unavailable' ) {

			throw new Error( 'Built-in AI model unavailable. Check chrome://flags' );

		}

		if ( availability === 'downloading' ) {

			throw new Error( 'Built-in AI model is downloading. Please wait and try again.' );

		}

		// Create session with system prompt
		const session = await LanguageModel.create( {
			initialPrompts: [
				{ role: 'system', content: systemPrompt },
				...messages.map( msg => ( {
					role: msg.role === 'assistant' ? 'assistant' : 'user',
					content: msg.content
				} ) )
			]
		} );

		// Get the last user message
		const lastMessage = messages[ messages.length - 1 ];

		if ( !lastMessage || lastMessage.role !== 'user' ) {

			throw new Error( 'No user message to send' );

		}

		// Send message and get response
		const response = await session.prompt( lastMessage.content );

		// Destroy session after use
		session.destroy();

		return response;

	}

}
