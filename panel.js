// DevTools panel script
// Handles UI interactions and communication with Claude API

const messagesContainer = document.getElementById('messages');
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
const apiKeyInput = document.getElementById('api-key');
const saveSettingsBtn = document.getElementById('save-settings');
const statusElement = document.getElementById('status');
const aiProviderSelect = document.getElementById('ai-provider');
const apiKeyHelp = document.getElementById('api-key-help');
const settingsTitle = document.getElementById('settings-title');

let claudeApiKey = '';
let geminiApiKey = '';
let aiProvider = 'claude';
let conversationHistory = [];
let backgroundPort = null;
let tabId = chrome.devtools.inspectedWindow.tabId;
let currentCode = { html: '', css: '', js: '' };
let isPortConnected = false;
let agent = null;

// Initialize connection to background script
function initConnection() {
  // Don't create a new connection if we already have one
  if (isPortConnected && backgroundPort) {
    return;
  }

  backgroundPort = chrome.runtime.connect({ name: 'devtools-panel' });
  isPortConnected = true;

  if (agent) agent.setBackgroundPort(backgroundPort);

  backgroundPort.postMessage({
    type: 'INIT',
    tabId: tabId
  });

  backgroundPort.onMessage.addListener((message) => {
    if (message.type === 'CONTENT_READY') {
      // Clear chat on page reload
      messagesContainer.innerHTML = '';
      conversationHistory = [];
      updateStatus(true);
      refreshCode();
    }

    if (message.type === 'CODE_DATA') {
      currentCode = message.data.code;
      updateStatus(true);
    }

    if (message.type === 'ERROR') {
      addSystemMessage('Error: ' + message.error);
    }
  });

  backgroundPort.onDisconnect.addListener(() => {
    isPortConnected = false;
    if (agent) agent.setPortConnected(false);
    updateStatus(false);
    setTimeout(() => {
      if (!isPortConnected) {
        initConnection();
      }
    }, 1000);
  });

  setTimeout(() => {
    refreshCode();
  }, 1000);
}

// Load saved API key
async function loadSettings() {
  const result = await chrome.storage.local.get(['claudeApiKey', 'geminiApiKey', 'aiProvider']);
  if (result.claudeApiKey) claudeApiKey = result.claudeApiKey;
  if (result.geminiApiKey) geminiApiKey = result.geminiApiKey;
  if (result.aiProvider) {
    aiProvider = result.aiProvider;
    aiProviderSelect.value = aiProvider;
  }
  updateApiKeyHelp();
  const currentKey = aiProvider === 'gemini' ? geminiApiKey : claudeApiKey;
  if (currentKey) {
    apiKeyInput.value = currentKey;
    createAgent();
  }
}

// Create agent based on selected provider
function createAgent() {
  if (aiProvider === 'browser') {
    agent = new BrowserAgent();
  } else if (aiProvider === 'gemini') {
    agent = new GeminiAgent(geminiApiKey);
  } else {
    agent = new ClaudeAgent(claudeApiKey);
  }
  if (backgroundPort) agent.setBackgroundPort(backgroundPort);
}

// Update API key help text based on provider
function updateApiKeyHelp() {
  if (aiProvider === 'browser') {
    settingsTitle.textContent = 'Browser Settings';
    apiKeyHelp.innerHTML = 'Uses built-in Chrome AI. Enable at <a href="chrome://flags/#prompt-api-for-gemini-nano" target="_blank">chrome://flags</a>';
  } else if (aiProvider === 'gemini') {
    settingsTitle.textContent = 'Gemini Settings';
    apiKeyHelp.innerHTML = 'Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a>';
  } else {
    settingsTitle.textContent = 'Claude Settings';
    apiKeyHelp.innerHTML = 'Get your API key from <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>';
  }
}

// Save API key
async function saveSettings() {
  if (aiProvider === 'browser') {
    createAgent();
    addSystemMessage('Settings saved (Browser)');
    settingsPanel.classList.add('hidden');
    return;
  }

  const newKey = apiKeyInput.value.trim();
  if (newKey) {
    if (aiProvider === 'gemini') {
      geminiApiKey = newKey;
      await chrome.storage.local.set({ geminiApiKey: geminiApiKey });
    } else {
      claudeApiKey = newKey;
      await chrome.storage.local.set({ claudeApiKey: claudeApiKey });
    }
    createAgent();
    addSystemMessage(`Settings saved (${aiProvider === 'gemini' ? 'Gemini' : 'Claude'})`);
    settingsPanel.classList.add('hidden');
  } else {
    addSystemMessage('Please enter a valid API key');
  }
}

// Update connection status
function updateStatus(connected) {
  if (connected) {
    statusElement.textContent = 'Connected to CodePen';
    statusElement.className = 'status-connected';
  } else {
    statusElement.textContent = 'Not connected';
    statusElement.className = 'status-disconnected';
  }
}

// Request code from CodePen
function refreshCode() {
  if (backgroundPort && isPortConnected) {
    try {
      backgroundPort.postMessage({
        type: 'GET_CODE',
        tabId: tabId
      });
    } catch (error) {
      console.error('Error sending GET_CODE message:', error);
      if (error.message.includes('disconnected port')) {
        isPortConnected = false;
        initConnection();
      }
    }
  }
}

// Add message to chat
function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message message-${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  // Format content with collapsible code blocks
  contentDiv.innerHTML = formatMessageContent(content);

  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);

  // Scroll to bottom after DOM updates
  scrollToBottom();

  return messageDiv;
}

// Scroll chat to bottom
function scrollToBottom() {
  // Use setTimeout to ensure DOM has updated
  setTimeout(() => {
    chatContainer.scrollTo({
      top: chatContainer.scrollHeight,
      behavior: 'smooth'
    });
  }, 0);
}

// Format SEARCH/REPLACE block as colored diff
function formatDiffBlock(blockContent, escapeHtml) {
  const sections = blockContent.split('<<<SEARCH>>>').filter(s => s.trim());
  let html = '';

  for (const section of sections) {
    if (!section.includes('<<<REPLACE>>>')) continue;

    const [searchPart, replacePart] = section.split('<<<REPLACE>>>');
    const searchText = searchPart.trim();
    const replaceText = replacePart.split('<<<')[0].trim();

    // Compute character-level diff
    const diff = Diff.diffChars(searchText, replaceText);

    let removeHtml = '';
    let addHtml = '';

    for (const part of diff) {
      const escaped = escapeHtml(part.value);
      if (part.removed) {
        removeHtml += '<span class="diff-highlight">' + escaped + '</span>';
      } else if (part.added) {
        addHtml += '<span class="diff-highlight">' + escaped + '</span>';
      } else {
        removeHtml += escaped;
        addHtml += escaped;
      }
    }

    html += '<div class="diff-block">';
    html += '<div class="diff-remove"><div class="diff-label">−</div><pre>' + removeHtml + '</pre></div>';
    html += '<div class="diff-add"><div class="diff-label">+</div><pre>' + addHtml + '</pre></div>';
    html += '</div>';
  }

  return html;
}

// Format message content with collapsible code blocks
function formatMessageContent(content) {
  // Escape HTML to prevent XSS
  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Pattern to match code blocks: [UPDATE_XXX]...[/UPDATE_XXX]
  const codeBlockPattern = /\[UPDATE_(HTML|CSS|JS)\]([\s\S]*?)\[\/UPDATE_\1\]/g;

  let lastIndex = 0;
  let result = '';
  let match;

  while ((match = codeBlockPattern.exec(content)) !== null) {
    // Add text before the code block (render as markdown)
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      result += marked.parse(textBefore);
    }

    const language = match[1].toLowerCase();
    const blockContent = match[2].trim();

    // Check if this is a SEARCH/REPLACE block or complete code
    if (blockContent.includes('<<<SEARCH>>>') && blockContent.includes('<<<REPLACE>>>')) {
      // Format as SEARCH/REPLACE diff with colored view
      const diffHtml = formatDiffBlock(blockContent, escapeHtml);
      result += `<details>
        <summary>${language.toUpperCase()} Changes</summary>
        <div class="diff-view">${diffHtml}</div>
      </details>`;
    } else {
      // Format as complete code
      result += `<details>
        <summary>${language.toUpperCase()} Code</summary>
        <pre><code>${escapeHtml(blockContent)}</code></pre>
      </details>`;
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block (render as markdown)
  if (lastIndex < content.length) {
    const textAfter = content.substring(lastIndex);
    result += marked.parse(textAfter);
  }

  return result;
}

// Add system message
function addSystemMessage(content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message message-system';
  messageDiv.textContent = content;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

// Add thinking indicator
function addThinkingMessage() {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message message-assistant';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content thinking';
  contentDiv.innerHTML = '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';

  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();

  return messageDiv;
}

// Send message to Claude
async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  if (!agent) {
    addSystemMessage('Please set your Anthropic API key in settings');
    settingsPanel.classList.remove('hidden');
    return;
  }

  // Add user message to chat
  addMessage('user', message);
  userInput.value = '';
  sendBtn.disabled = true;

  // Add thinking indicator
  const thinkingMessage = addThinkingMessage();

  // Refresh code before sending
  await new Promise(resolve => {
    if (backgroundPort && isPortConnected) {
      try {
        backgroundPort.postMessage({
          type: 'GET_CODE',
          tabId: tabId
        });
        // Wait a bit for the response
        setTimeout(resolve, 500);
      } catch (error) {
        console.error('Error sending GET_CODE message:', error);
        if (error.message.includes('disconnected port')) {
          isPortConnected = false;
          initConnection();
        }
        resolve();
      }
    } else {
      resolve();
    }
  });

  // Build system prompt with current code
  const systemPrompt = buildSystemPrompt();

  // Add to conversation history
  conversationHistory.push({
    role: 'user',
    content: message
  });

  try {
    // Call Claude API
    const response = await agent.sendMessage(systemPrompt, conversationHistory);

    // Remove thinking indicator
    thinkingMessage.remove();

    // Add assistant response
    addMessage('assistant', response);

    // Add to history (strip out UPDATE blocks to avoid confusion)
    const responseWithoutCode = response.replace(/\[UPDATE_(HTML|CSS|JS)\][\s\S]*?\[\/UPDATE_\1\]/g, '').trim();
    conversationHistory.push({
      role: 'assistant',
      content: responseWithoutCode || 'Code updated.'
    });

    // Check if we need to update code
    const errors = await processAssistantResponse(response);

    // If there were search/replace errors, add them to conversation history
    if (errors && errors.length > 0) {
      const errorMessage = 'The following SEARCH blocks could not be found in the current code:\n\n' +
        errors.join('\n\n') +
        '\n\nPlease check the CURRENT CODE section and try again with the exact code that exists.';

      conversationHistory.push({
        role: 'user',
        content: errorMessage
      });
    }

  } catch (error) {
    // Remove thinking indicator on error
    thinkingMessage.remove();
    addSystemMessage('Error: ' + error.message);
    console.error('Error calling Claude API:', error);
  } finally {
    sendBtn.disabled = false;
  }
}

// Build system prompt with current CodePen code
function buildSystemPrompt() {
  return `You are an AI coding assistant integrated into Chrome DevTools for CodePen. You can read and modify the code in the CodePen editor.

=== CURRENT CODE IN EDITOR (always fresh, always up-to-date) ===

HTML:
\`\`\`html
${currentCode.html || '(empty)'}
\`\`\`

CSS:
\`\`\`css
${currentCode.css || '(empty)'}
\`\`\`

JavaScript:
\`\`\`javascript
${currentCode.js || '(empty)'}
\`\`\`

=== END CURRENT CODE ===

CRITICAL: The code shown above is the ACTUAL, CURRENT state of the CodePen editor RIGHT NOW. Always use this code as your reference, not code from previous messages in the conversation. This code is refreshed on every request.

When the user asks you to modify code:
1. FIRST: Look at the CURRENT CODE section above to see what's actually in the editor
2. Respond with a clear explanation of what you've done (use past tense)
3. Use special markers to indicate code changes using SEARCH/REPLACE blocks:
   - [UPDATE_HTML]...[/UPDATE_HTML]
   - [UPDATE_CSS]...[/UPDATE_CSS]
   - [UPDATE_JS]...[/UPDATE_JS]
4. Inside the markers, use this format for each change:
   <<<SEARCH>>>
   exact code to find and replace (copy EXACTLY from CURRENT CODE above)
   <<<REPLACE>>>
   new code to replace with

Example:
User: "Change the background to blue"
You: "I've updated the CSS to change the background to blue.

[UPDATE_CSS]
<<<SEARCH>>>
background: red;
<<<REPLACE>>>
background: blue;
[/UPDATE_CSS]"

Important:
- Do not use markdown formatting in your responses. Write plain text without bold, italics, lists, or code blocks (except for the UPDATE markers above).
- ALWAYS refer to the CURRENT CODE section at the top - it's always up-to-date
- IGNORE any code from previous messages - ONLY use the CURRENT CODE section above
- SEARCH blocks must match the CURRENT CODE EXACTLY (including all whitespace and indentation)
- Copy-paste from the CURRENT CODE section to ensure exact matches
- You can have multiple SEARCH/REPLACE pairs in one UPDATE block
- Keep SEARCH blocks small and focused - just the lines you need to change

Be concise and helpful. Focus on the specific changes requested.`;
}

// Process assistant response and update CodePen if needed
async function processAssistantResponse(response) {
  const updates = {
    html: applySearchReplace(currentCode.html, response, 'UPDATE_HTML'),
    css: applySearchReplace(currentCode.css, response, 'UPDATE_CSS'),
    js: applySearchReplace(currentCode.js, response, 'UPDATE_JS')
  };

  const allErrors = [];

  for (const [editor, result] of Object.entries(updates)) {
    if (result !== null) {
      if (result.errors && result.errors.length > 0) {
        allErrors.push(...result.errors);
      }
      if (result.code) {
        // Update our local copy
        currentCode[editor] = result.code;
        // Update CodePen with line highlighting
        await updateCodePenEditor(editor, result.code, result.lines);
        addSystemMessage(`Updated ${editor.toUpperCase()} editor`);
      }
    }
  }

  return allErrors.length > 0 ? allErrors : null;
}

// Apply SEARCH/REPLACE blocks to code
function applySearchReplace(currentCode, responseText, marker) {
  const startMarker = `[${marker}]`;
  const endMarker = `[/${marker}]`;
  const startIndex = responseText.indexOf(startMarker);
  const endIndex = responseText.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  const blockContent = responseText.substring(startIndex + startMarker.length, endIndex);
  let newCode = currentCode || '';

  // Split by <<<SEARCH>>> to find all search/replace pairs
  const sections = blockContent.split('<<<SEARCH>>>').filter(s => s.trim());
  let hasChanges = false;
  const changedLines = new Set();
  const errors = [];

  for (const section of sections) {
    // Check if this section has a <<<REPLACE>>> marker
    if (!section.includes('<<<REPLACE>>>')) {
      continue;
    }

    const [searchPart, replacePart] = section.split('<<<REPLACE>>>');
    const searchText = searchPart.trim();
    const replaceText = replacePart.split('<<<')[0].trim(); // Stop at next marker or end

    const searchIndex = newCode.indexOf(searchText);
    if (searchIndex !== -1) {
      // Find which lines were affected
      const beforeSearch = newCode.substring(0, searchIndex);
      const startLine = beforeSearch.split('\n').length - 1;
      const searchLines = searchText.split('\n').length;
      const replaceLines = replaceText.split('\n').length;

      // Mark affected lines
      for (let i = 0; i < Math.max(searchLines, replaceLines); i++) {
        changedLines.add(startLine + i);
      }

      newCode = newCode.replace(searchText, replaceText);
      hasChanges = true;
    } else {
      const editorName = marker.replace('UPDATE_', '');
      const errorMsg = `In ${editorName} editor, could not find:\n${searchText}`;
      console.warn(errorMsg);
      errors.push(errorMsg);
      addSystemMessage(`Could not find text to replace in ${editorName}`);
    }
  }

  // Return result with errors
  if (hasChanges) {
    return { code: newCode, lines: Array.from(changedLines), errors };
  } else if (errors.length > 0) {
    // No changes made, but there were errors
    return { code: null, lines: [], errors };
  } else {
    return null;
  }
}

// Update CodePen editor
async function updateCodePenEditor(editor, newCode, changedLines = []) {
  return new Promise((resolve) => {
    if (backgroundPort && isPortConnected) {
      try {
        backgroundPort.postMessage({
          type: 'UPDATE_CODE',
          tabId: tabId,
          editor: editor,
          code: newCode,
          changedLines: changedLines
        });
      } catch (error) {
        console.error('Error sending UPDATE_CODE message:', error);
        isPortConnected = false;
        if (error.message.includes('disconnected port')) {
          initConnection();
        }
      }
    }
    setTimeout(resolve, 200);
  });
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', saveSettings);

aiProviderSelect.addEventListener('change', async () => {
  aiProvider = aiProviderSelect.value;
  await chrome.storage.local.set({ aiProvider: aiProvider });
  updateApiKeyHelp();

  if (aiProvider === 'browser') {
    apiKeyInput.value = '';
    createAgent();
  } else {
    const currentKey = aiProvider === 'gemini' ? geminiApiKey : claudeApiKey;
    apiKeyInput.value = currentKey;
    if (currentKey) {
      createAgent();
    } else {
      agent = null;
    }
  }

  const providerName = aiProvider === 'gemini' ? 'Gemini' : aiProvider === 'browser' ? 'Browser' : 'Claude';
  addSystemMessage(`Switched to ${providerName}`);
});

// Initialize
loadSettings();
initConnection();

// Check connection status after a delay and show appropriate message
setTimeout(() => {
  const isConnected = statusElement.classList.contains('status-connected');
  if (!isConnected) {
    addSystemMessage('Make sure you are on a CodePen editor page (codepen.io/pen/).');
    addSystemMessage('If status shows "Not connected", check the Console for debugging info.');
  }
}, 1500);
