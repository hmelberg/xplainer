console.log('components.js file loaded successfully!');


// UI Question Web Component
// This component creates an interactive question-answer interface

// Helper function to create button elements
function _fixtag(tagName) {
    return tagName;
}

const buttonTag = _fixtag("button");

class QAComponent extends HTMLElement {
    static get observedAttributes() {
        return ['question', 'answer', 'hint', 'hint_threshold', 'record', 'see_answer', 'layout', 'card', 'markdown', 'submit'];
    }

    constructor() {
        super();
        this._question = this.getAttribute('question') || '';
        this._answer = (this.getAttribute('answer') || '').split(',').map(a => a.trim().toLowerCase());  // Handle multiple answers by splitting and trimming
        this._hint = this.getAttribute('hint') || '';
        this.hint_threshold = parseInt(this.getAttribute('hint_threshold')) || 3;
        this.answered_correctly = false;
        this.attempts = 0;
        this.record = this.hasAttribute('record') && this.getAttribute('record') === 'true';
        this.see_answer = this.getAttribute('see_answer') === 'true';
        this.layout = this.getAttribute('layout') || 'vertical';
        this.card = this.getAttribute('card') !== 'false';  // Default to true unless explicitly set to false
        this.markdown = this.getAttribute('markdown') === 'true';  // Default to false
        this.submit = this.getAttribute('submit') !== 'false';  // Default to true
        this.rendered = false;  // Prevent rendering until connected
    }

    get question() {
        return this._question;
    }

    set question(value) {
        this._question = value;
        if (this.rendered) this.render();
    }

    get answer() {
        return this._answer;
    }

    set answer(value) {
        this._answer = Array.isArray(value) ? value.map(a => a.trim().toLowerCase()) : [value.trim().toLowerCase()];
    }

    get hint() {
        return this._hint;
    }

    set hint(value) {
        this._hint = value;
        if (this.rendered) this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        this[name] = newValue;
        if (this.rendered) this.render();
    }

    connectedCallback() {
        this.render();
        this.rendered = true;  // Mark as rendered once added to the DOM
    }

    render() {
        this.innerHTML = ''; // Clear any existing content

        // Main container to hold all elements
        const container = document.createElement('div');
        container.style.padding = '10px';  // Reduced padding for card-like appearance
        container.style.textAlign = 'center';  // Center all elements
        container.style.display = 'block';  // Ensure vertical layout

        if (this.card) {
            container.classList.add("card-default")
        }

        // Question display
        let questionElement;
        if (this.markdown) {
            questionElement = document.createElement('ui-markdown');
            questionElement.content = this._question;  // Use content property to set Markdown
        } else {
            questionElement = document.createElement('div');
            questionElement.textContent = this._question;  // Plain text question
            questionElement.style.fontWeight = 'bold';  // Bold text
            questionElement.style.fontSize = '1.2em';  // Larger than normal font
            questionElement.style.marginBottom = '10px';  // Space after question
        }

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.style.display = 'block';  // Ensure it's on a new line
        this.input.style.margin = '5px auto';  // Center input box
        this.input.style.padding = '8px';
        this.input.style.border = '1px solid #ccc';
        this.input.style.borderRadius = '4px';
        this.input.style.width = '80%';  // Adjust width to fit nicely in the card

        const buttonContainer = document.createElement('div');
        buttonContainer.style.marginTop = '10px';  // Space between input and buttons

        // Submit button
        if (this.submit) {
            const submitButton = document.createElement(buttonTag);
            submitButton.textContent = 'Submit';
            //submitButton.classList.add("button-default")
            submitButton.addEventListener('click', this.checkAnswer.bind(this));
            buttonContainer.appendChild(submitButton);
        }

        // See Answer button
        const seeAnswerButton = document.createElement(buttonTag);
        seeAnswerButton.textContent = 'See Answer';
        seeAnswerButton.style.display = this.see_answer ? 'inline' : 'none';
        seeAnswerButton.addEventListener('click', this.showAnswer.bind(this));

        buttonContainer.appendChild(seeAnswerButton);

        // Message for response (correct/incorrect)
        this.messageSpan = document.createElement('div');
        this.messageSpan.style.marginTop = '10px';
        this.messageSpan.style.color = 'green';  // Initially green for success

        // Hint div
        this.hintDiv = document.createElement('div');
        this.hintDiv.textContent = `Hint: ${this._hint}`;
        this.hintDiv.style.display = 'none';  // Hide hint by default
        this.hintDiv.style.marginTop = '10px';

        // Add event listeners for input
        this.input.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                this.checkAnswer();  // Check answer when pressing Enter
            }
        });

        // Append elements to the container
        container.appendChild(questionElement);
        container.appendChild(this.input);
        container.appendChild(buttonContainer);  // Add buttons in a separate container
        container.appendChild(this.messageSpan);  // Add response message below buttons
        container.appendChild(this.hintDiv);  // Add hint div

        this.appendChild(container);  // Append everything to the light DOM
    }

    checkAnswer() {
        this.attempts += 1;

        const userInput = this.input.value.trim().toLowerCase();  // Trim and convert to lowercase for comparison
        window._ui_record_event({"event":"question", "answer":userInput});

        if (this._answer.includes(userInput)) {
            this.messageSpan.textContent = 'Correct!';
            this.messageSpan.style.color = 'green';
            this.answered_correctly = true;
        } else {

            this.messageSpan.textContent = 'Try again.';
            this.messageSpan.style.color = 'red';
            if (this.attempts >= this.hint_threshold) {
                this.hintDiv.style.display = 'block';  // Show hint after max attempts
            }
        }
    }

    showAnswer() {
        this.hintDiv.style.display = 'block';
        this.hintDiv.textContent = `Answer: ${this._answer.join(', ')}`;
    }

    recordSuccess() {
        console.log(`Success recorded for question: ${this._question}`);
    }
}

// Register the custom element
customElements.define('ui-question', QAComponent);

// Altair Chart Component with Lazy Loading
class UIAltair extends HTMLElement {
  constructor() {
    super();
    this.container = document.createElement('div');
    this.librariesLoaded = false;
    this.pendingRender = false;
  }

  connectedCallback() {
    // Ensure the container is added to the DOM only when connected
    if (!this.container.isConnected) {
      this.appendChild(this.container);
    }
    this.renderPlot();
  }

  static get observedAttributes() {
    return ['json_str'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'json_str' && oldValue !== newValue && this.isConnected) {
      this.renderPlot();
    }
  }

  get json_str() {
    return this.getAttribute('json_str');
  }

  set json_str(value) {
    this.setAttribute('json_str', value);
  }

  async loadVegaLibraries() {
    if (this.librariesLoaded) return;
    
    // Check if libraries are already loaded
    if (window.vega && window.vegaLite && window.vegaEmbed) {
      this.librariesLoaded = true;
      return;
    }

    try {
      // Load Vega libraries dynamically
      const libraries = [
        'https://cdn.jsdelivr.net/npm/vega',
        'https://cdn.jsdelivr.net/npm/vega-lite', 
        'https://cdn.jsdelivr.net/npm/vega-embed'
      ];

      const loadPromises = libraries.map(src => {
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      });

      await Promise.all(loadPromises);
      this.librariesLoaded = true;
      console.log('Vega libraries loaded successfully');
    } catch (error) {
      console.error('Failed to load Vega libraries:', error);
      throw error;
    }
  }

  async renderPlot() {
    const plotData = this.json_str;
    if (!plotData || !this.isConnected) return;

    try {
      // Load libraries if not already loaded
      await this.loadVegaLibraries();
      
      const plotSpec = JSON.parse(plotData);
      // Use vegaEmbed to render the plot
      await vegaEmbed(this.container, plotSpec);
    } catch (error) {
      console.error('Error rendering Altair plot:', error);
      this.container.innerHTML = `<div style="color: red; padding: 10px;">Error rendering plot: ${error.message}</div>`;
    }
  }
}

// Register the Altair component
customElements.define('ui-altair', UIAltair); 



// UI Typewriter Component
class UITypewriter extends HTMLElement {
    static get observedAttributes() {
        return ['content', 'language', 'voice', 'volume', 'rate', 'pitch', 'blocking', 'typewriter', 'silent', 'delay'];
    }

    constructor() {
        super();
        this._content = this.getAttribute('content') || "No content provided.";
        this._language = this.getAttribute('language') || "en-GB";
        this._voice = this.getAttribute('voice') || "female";
        this._volume = parseFloat(this.getAttribute('volume')) || 1;
        this._rate = parseFloat(this.getAttribute('rate')) || 1;
        this._pitch = parseFloat(this.getAttribute('pitch')) || 1;
        this._blocking = this.getAttribute('blocking') === 'true';
        this._typewriter = this.getAttribute('typewriter') !== 'false'; // Default to true
        this._silent = this.getAttribute('silent') === 'true';
        console.log('Parsed silent attribute:', this.getAttribute('silent'), '->', this._silent);
        this._delay = parseInt(this.getAttribute('delay')) || 80;
        this.isPlaying = false;
        this.rendered = false;

        // Initialize speech synthesis
        this.synth = window.speechSynthesis;
        this.voicesLoaded = false;
    }

    get content() {
        return this._content;
    }

    set content(value) {
        this._content = value;
        this.setupProperties();
        if (this.rendered) this.render();
    }

    get language() {
        return this._language;
    }

    set language(value) {
        this._language = value;
        this.setupProperties();
    }

    get voice() {
        return this._voice;
    }

    set voice(value) {
        this._voice = value;
        this.setupProperties();
    }

    get volume() {
        return this._volume;
    }

    set volume(value) {
        this._volume = parseFloat(value);
        this.setupProperties();
    }

    get rate() {
        return this._rate;
    }

    set rate(value) {
        this._rate = parseFloat(value);
        this.setupProperties();
    }

    get pitch() {
        return this._pitch;
    }

    set pitch(value) {
        this._pitch = parseFloat(value);
        this.setupProperties();
    }

    get blocking() {
        return this._blocking;
    }

    set blocking(value) {
        this._blocking = value;
    }

    get typewriter() {
        return this._typewriter;
    }

    set typewriter(value) {
        this._typewriter = value;
    }

    get silent() {
        return this._silent;
    }

    set silent(value) {
        this._silent = value;
        if (this.rendered) this.render();
    }

    get delay() {
        return this._delay;
    }

    set delay(value) {
        this._delay = parseInt(value);
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        this.render();
        this.rendered = true;
    }

    setupProperties() {
        // Create a new utterance each time to ensure fresh state
        this.utterance = new SpeechSynthesisUtterance();
        this.utterance.text = this._content;
        this.utterance.lang = this._language;
        this.utterance.volume = this._volume;
        this.utterance.rate = this._rate;
        this.utterance.pitch = this._pitch;

        // Wait for voices to load if they haven't already
        if (this.synth.getVoices().length === 0) {
            if (!this.voicesLoaded) {
                this.synth.addEventListener('voiceschanged', () => {
                    this.voicesLoaded = true;
                    this.setVoice();
                });
            }
        } else {
            this.voicesLoaded = true;
            this.setVoice();
        }
    }

    setVoice() {
        const voices = this.synth.getVoices();
        console.log('Available voices:', voices.length);
        console.log('Looking for language:', this._language, 'voice type:', this._voice);

        // Determine the voice based on the _voice attribute
        if (this._voice.toLowerCase() === "female") {
            this.utterance.voice = voices.find(voice => 
                voice.lang === this._language && voice.name.toLowerCase().includes("female")
            );
        } else if (this._voice.toLowerCase() === "male") {
            this.utterance.voice = voices.find(voice => 
                voice.lang === this._language && voice.name.toLowerCase().includes("male")
            );
        } else if (this._voice.toLowerCase() === "random") {
            const filteredVoices = voices.filter(voice => voice.lang === this._language);
            this.utterance.voice = filteredVoices[Math.floor(Math.random() * filteredVoices.length)];
        } else {
            this.utterance.voice = voices.find(voice => 
                voice.lang === this._language && voice.name === this._voice
            );
        }

        // Fallback to any voice for the language if the specific one isn't found
        if (!this.utterance.voice) {
            this.utterance.voice = voices.find(voice => voice.lang === this._language);
        }

        // Final fallback to any available voice
        if (!this.utterance.voice && voices.length > 0) {
            this.utterance.voice = voices[0];
        }

        console.log('Selected voice:', this.utterance.voice ? this.utterance.voice.name : 'None');
    }

    render() {
        console.log('Rendering typewriter component with content:', this._content);
        this.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = '10px';
        container.style.textAlign = 'center';
        container.style.cursor = 'pointer';
        container.style.border = '1px solid #ddd';
        container.style.borderRadius = '4px';
        container.style.backgroundColor = '#f9f9f9';
        container.style.margin = '5px 0';

        // Create display text
        let displayText = this._content.substring(0, 50);
        if (this._content.length > 50) {
            displayText += '...';
        }
        displayText += ' ▶';  // Add play symbol
        if (!this._silent) {
            displayText += ' 🔊';  // Add sound/speak symbol
        }

        container.textContent = displayText;

        // Add click event listener
        container.addEventListener('click', (event) => {
            console.log('Typewriter component clicked!');
                    console.log('Current playing state:', this.isPlaying);
        console.log('Silent setting:', this._silent);
        console.log('Typewriter setting:', this._typewriter);
        event.stopPropagation(); // Prevent event bubbling
        
        if (this.isPlaying) {
            console.log('Stopping playback...');
            this.stop();
        } else {
            console.log('Starting playback...');
            this.playFromStart();
        }
        });

        this.appendChild(container);
        this.container = container;
    }

    async playFromStart() {
        console.log('=== playFromStart called ===');
        console.log('Silent setting:', this._silent);
        console.log('Typewriter setting:', this._typewriter);
        console.log('Content:', this._content);
        
        // Prevent multiple simultaneous calls
        if (this.isPlaying) {
            console.log('Already playing, ignoring call');
            return;
        }
        
        this.isPlaying = true;

        // Remove any existing replay button
        const existingButton = this.querySelector('.replay-button');
        if (existingButton) {
            existingButton.remove();
        }

        this.container.textContent = '';  // Clear display to start from the beginning

        let speechPromise = Promise.resolve();
        console.log('About to check silent condition...');
        console.log('this._silent value:', this._silent);
        console.log('!this._silent value:', !this._silent);
        console.log('typeof this._silent:', typeof this._silent);
        
        // Check if speech should be enabled
        const shouldSpeak = this._silent !== 'true' && this._silent !== true;
        console.log('Should speak:', shouldSpeak);
        
        if (this.synth && shouldSpeak) {
            // Create a fresh utterance for this speech session
            const utterance = new SpeechSynthesisUtterance(this._content);
            utterance.lang = this._language;
            utterance.volume = this._volume;
            utterance.rate = this._rate;
            utterance.pitch = this._pitch;
            
            // Set up the voice
            const voices = this.synth.getVoices();
            if (this._voice.toLowerCase() === "female") {
                utterance.voice = voices.find(voice => 
                    voice.lang === this._language && voice.name.toLowerCase().includes("female")
                );
            } else if (this._voice.toLowerCase() === "male") {
                utterance.voice = voices.find(voice => 
                    voice.lang === this._language && voice.name.toLowerCase().includes("male")
                );
            } else if (this._voice.toLowerCase() === "random") {
                const filteredVoices = voices.filter(voice => voice.lang === this._language);
                utterance.voice = filteredVoices[Math.floor(Math.random() * filteredVoices.length)];
            } else {
                utterance.voice = voices.find(voice => 
                    voice.lang === this._language && voice.name === this._voice
                );
            }

            // Fallback to any voice for the language if the specific one isn't found
            if (!utterance.voice) {
                utterance.voice = voices.find(voice => voice.lang === this._language);
            }

            // Final fallback to any available voice
            if (!utterance.voice && voices.length > 0) {
                utterance.voice = voices[0];
            }
            
            console.log('Attempting to speak:', this._content);
            console.log('Speech synthesis available:', !!this.synth);
            console.log('Utterance prepared:', utterance);
            console.log('Utterance text:', utterance.text);
            console.log('Utterance voice:', utterance.voice ? utterance.voice.name : 'None');
            
            try {
            speechPromise = new Promise((resolve) => {
                    utterance.onstart = () => {
                        console.log('Speech started');
                    };
                    utterance.onend = () => {
                        console.log('Speech ended');
                    resolve();
                };
                    utterance.onerror = (error) => {
                        console.error('Speech error:', error);
                        resolve();
                    };
                    
                    // Start speaking after setting up all event handlers
                    this.synth.speak(utterance);
                    console.log('speak() called');
                });
            } catch (error) {
                console.error('Error starting speech:', error);
            }
        } else {
            console.error('Speech synthesis not available');
        }

        let typingPromise = Promise.resolve();
        if (this._typewriter) {
            typingPromise = this.typeText();
        }

        console.log('About to wait for promises...');
        await Promise.all([speechPromise, typingPromise]);
        console.log('Promises completed');

        this.isPlaying = false;
        console.log('Set isPlaying to false');

        // Add the replay button
        this.addReplayButton();
        console.log('Added replay button');
    }

    async typeText() {
        for (let i = 0; i < this._content.length; i++) {
            if (!this.isPlaying) break;  // Exit if stopped
            this.container.textContent += this._content[i];
            await this.sleepWithRandomness(this._delay);
        }
    }

    sleepWithRandomness(baseDelay) {
        const randomFactor = Math.random() * 50 - 25;  // Randomness between -25ms and +25ms
        return new Promise(resolve => setTimeout(resolve, baseDelay + randomFactor));
    }

    stop() {
        if (this.synth.speaking || this.synth.paused) {
            this.synth.cancel();
        }
        this.isPlaying = false;
        this.render();  // Reset to initial display
    }

    addReplayButton() {
        const replayButton = document.createElement(buttonTag);
        replayButton.textContent = 'Replay';
        replayButton.classList.add('replay-button');
        replayButton.style.marginTop = '10px';
        replayButton.addEventListener('click', () => {
            this.playFromStart();
        });
        this.appendChild(replayButton);
    }
}

// Register the typewriter component
customElements.define('ui-typewriter', UITypewriter);

// YouTube Video Component
class UIYouTube extends HTMLElement {
    static get observedAttributes() {
        return ['video_id', 'start_time', 'end_time', 'autoplay', 'controls', 'loop'];
    }

    constructor() {
        super();
        this._player = null;
        this._video_id = this.getAttribute('video_id') || '';
        this._start_time = parseInt(this.getAttribute('start_time')) || 0;
        this._end_time = parseInt(this.getAttribute('end_time')) || 0;
        this._autoplay = this.getAttribute('autoplay') === 'true';
        this._controls = this.getAttribute('controls') !== 'false'; // Default to true
        this._loop = this.getAttribute('loop') === 'true';
        this.rendered = false;
        
        // Load YouTube API if not already loaded
        this.loadYouTubeAPI();
    }

    get video_id() {
        return this._video_id;
    }

    set video_id(value) {
        this._video_id = value;
        if (this.rendered) this.render();
    }

    get start_time() {
        return this._start_time;
    }

    set start_time(value) {
        this._start_time = parseInt(value) || 0;
        if (this._player && this._player.seekTo) {
            this._player.seekTo(this._start_time);
        }
    }

    get end_time() {
        return this._end_time;
    }

    set end_time(value) {
        this._end_time = parseInt(value) || 0;
    }

    get autoplay() {
        return this._autoplay;
    }

    set autoplay(value) {
        this._autoplay = value === 'true' || value === true;
        if (this.rendered) this.render();
    }

    get controls() {
        return this._controls;
    }

    set controls(value) {
        this._controls = value !== 'false' && value !== false;
        if (this.rendered) this.render();
    }

    get loop() {
        return this._loop;
    }

    set loop(value) {
        this._loop = value === 'true' || value === true;
        if (this.rendered) this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        this.render();
        this.rendered = true;
    }

    loadYouTubeAPI() {
        if (window.YT) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            // Create script tag for YouTube API
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.onload = () => {
                // YouTube API callback
                window.onYouTubeIframeAPIReady = () => {
                    resolve();
                };
            };
            document.head.appendChild(script);
        });
    }

    render() {
        this.innerHTML = '';

        if (!this._video_id) {
            const placeholder = document.createElement('div');
            placeholder.textContent = 'No video ID provided';
            placeholder.style.padding = '20px';
            placeholder.style.textAlign = 'center';
            placeholder.style.backgroundColor = '#f0f0f0';
            placeholder.style.border = '1px solid #ccc';
            this.appendChild(placeholder);
            return;
        }

        // Create container for the player
        const container = document.createElement('div');
        container.style.width = '100%';
        container.style.maxWidth = '560px';
        container.style.margin = '0 auto';
        
        // Create the player div
        const playerDiv = document.createElement('div');
        playerDiv.id = `youtube-player-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        container.appendChild(playerDiv);
        this.appendChild(container);

        // Initialize player when API is ready
        this.loadYouTubeAPI().then(() => {
            if (window.YT && window.YT.Player) {
                this._player = new YT.Player(playerDiv.id, {
                    height: '315',
                    width: '100%',
                    videoId: this._video_id,
                    playerVars: {
                        autoplay: this._autoplay ? 1 : 0,
                        start: this._start_time,
                        end: this._end_time || undefined,
                        controls: this._controls ? 1 : 0,
                        loop: this._loop ? 1 : 0,
                        fs: 1,
                        rel: 0, // Don't show related videos
                        modestbranding: 1
                    },
                    events: {
                        onReady: (event) => {
                            console.log('YouTube player ready');
                        },
                        onStateChange: (event) => {
                            // Handle video state changes if needed
                        }
                    }
                });
            }
        });
    }

    play() {
        if (this._player && this._player.playVideo) {
            this._player.playVideo();
        }
    }

    pause() {
        if (this._player && this._player.pauseVideo) {
            this._player.pauseVideo();
        }
    }

    stop() {
        if (this._player && this._player.stopVideo) {
            this._player.stopVideo();
        }
    }

    seekTo(seconds) {
        if (this._player && this._player.seekTo) {
            this._player.seekTo(seconds);
        }
    }
}

// Register the YouTube component
customElements.define('ui-youtube', UIYouTube);

// Multiple Choice Question Component
class UIMultipleChoice extends HTMLElement {
    static get observedAttributes() {
        return ['question', 'options', 'answer', 'src', 'points', 'show_feedback', 'card', 'record', 'show_results'];
    }

    constructor() {
        super();
        this._question = this.getAttribute('question') || '';
        this._options = JSON.parse(this.getAttribute('options') || '[]');
        this._answer = this.getAttribute('answer') || '';
        this._points = parseInt(this.getAttribute('points')) || 10;
        this._src = this.getAttribute('src') || '';
        this._showFeedback = this.getAttribute('show_feedback') !== 'false'; // Default to true
        this._card = this.getAttribute('card') !== 'false'; // Default to true
        this._record = this.getAttribute('record') === 'true';
        this._showResults = this.getAttribute('show_results') === 'true';
        this.selectedOptionElement = null;
        this.answered = false;
        this.rendered = false;
    }

    get question() {
        return this._question;
    }

    set question(value) {
        this._question = value;
        if (this.rendered) this.render();
    }

    get options() {
        return this._options;
    }

    set options(value) {
        this._options = Array.isArray(value) ? value : JSON.parse(value || '[]');
        if (this.rendered) this.render();
    }

    get answer() {
        return this._answer;
    }

    set answer(value) {
        this._answer = value;
    }

    get points() {
        return this._points;
    }

    set points(value) {
        this._points = parseInt(value) || 10;
    }

    get src() {
        return this._src;
    }

    set src(value) {
        this._src = value;
        if (this.rendered) this.render();
    }

    get showFeedback() {
        return this._showFeedback;
    }

    set showFeedback(value) {
        this._showFeedback = value !== 'false' && value !== false;
        if (this.rendered) this.render();
    }



    get card() {
        return this._card;
    }

    set card(value) {
        this._card = value !== 'false' && value !== false && value !== 'none';
        if (this.rendered) this.render();
    }

    get record() {
        return this._record;
    }

    set record(value) {
        this._record = value === 'true' || value === true;
    }

    get showResults() {
        return this._showResults;
    }

    set showResults(value) {
        this._showResults = value === 'true' || value === true;
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        this.render();
        this.rendered = true;
    }

    render() {
        this.innerHTML = '';

        // Main container
        const container = document.createElement('div');
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.maxWidth = '600px';
        container.style.margin = '0 auto';
        container.style.padding = '15px';

        if (this._card) {
            container.style.border = '1px solid #ddd';
            container.style.borderRadius = '8px';
            container.style.backgroundColor = '#f9f9f9';
            container.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }

        // Image if provided
        if (this._src) {
            const image = document.createElement('img');
            image.src = this._src;
            image.style.maxWidth = '100%';
            image.style.height = 'auto';
            image.style.marginBottom = '15px';
            image.style.borderRadius = '4px';
            container.appendChild(image);
        }

        // Question text
        const questionDiv = document.createElement('div');
        questionDiv.textContent = this._question;
        questionDiv.style.fontWeight = 'bold';
        questionDiv.style.fontSize = '1.1em';
        questionDiv.style.marginBottom = '15px';
        questionDiv.style.color = '#333';
        container.appendChild(questionDiv);

        // Generate unique name for this component's radio buttons (all options share the same name)
        const radioGroupName = `mcq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Options
        this._options.forEach((option, index) => {
            const optionContainer = document.createElement('div');
            optionContainer.style.display = 'flex';
            optionContainer.style.alignItems = 'center';
            optionContainer.style.marginBottom = '10px';
            optionContainer.style.padding = '8px';
            optionContainer.style.borderRadius = '4px';
            optionContainer.style.cursor = 'pointer';
            optionContainer.style.transition = 'background-color 0.2s';
            optionContainer.id = `option-container-${index}`;

            // Radio button
            const radioButton = document.createElement('input');
            radioButton.type = 'radio';
            radioButton.name = radioGroupName; // All options in this component share the same name
            radioButton.value = option;
            radioButton.id = `option-${index}-${radioGroupName}`;
            radioButton.style.marginRight = '10px';
            radioButton.disabled = this.answered;

            // Label
            const label = document.createElement('label');
            label.htmlFor = radioButton.id;
            label.textContent = option;
            label.style.cursor = 'pointer';
            label.style.flex = '1';

            // Click handler
            const handleClick = () => {
                if (!this.answered) {
                    this.checkAnswer(option, optionContainer);
                }
            };

            optionContainer.addEventListener('click', handleClick);
            radioButton.addEventListener('change', handleClick);

            optionContainer.appendChild(radioButton);
            optionContainer.appendChild(label);
            container.appendChild(optionContainer);
        });

        this.appendChild(container);
    }

    checkAnswer(selectedOption, selectedOptionElement) {
        this.answered = true;

        // Reset all options to default state
        const allOptions = this.querySelectorAll('[id^="option-container-"]');
        allOptions.forEach(option => {
            option.style.backgroundColor = '';
            option.style.border = '';
            option.style.color = '';
            const icon = option.querySelector('.feedback-icon');
            if (icon) icon.remove();
        });

        const correct = selectedOption === this._answer;

        // Add feedback for selected option
        if (this._showFeedback) {
            if (correct) {
                selectedOptionElement.style.backgroundColor = '#d4edda';
                selectedOptionElement.style.border = '1px solid #c3e6cb';
                selectedOptionElement.style.color = '#155724';
            } else {
                selectedOptionElement.style.backgroundColor = '#f8d7da';
                selectedOptionElement.style.border = '1px solid #f5c6cb';
                selectedOptionElement.style.color = '#721c24';
            }

            // Add icon for selected option
            const icon = document.createElement('span');
            icon.classList.add('feedback-icon');
            icon.textContent = correct ? '✔' : '✖';
            icon.style.marginRight = '10px';
            icon.style.fontWeight = 'bold';
            icon.style.color = correct ? '#28a745' : '#dc3545';
            selectedOptionElement.insertBefore(icon, selectedOptionElement.firstChild);
        }

        // Show correct answer if wrong answer was selected and feedback is enabled
        if (!correct && this._showFeedback) {
            // Find the correct answer element
            const correctOptionElement = Array.from(allOptions).find(option => {
                const radioButton = option.querySelector('input[type="radio"]');
                return radioButton && radioButton.value === this._answer;
            });

            if (correctOptionElement) {
                correctOptionElement.style.backgroundColor = '#d4edda';
                correctOptionElement.style.border = '1px solid #c3e6cb';
                correctOptionElement.style.color = '#155724';

                // Add checkmark for correct answer
                const correctIcon = document.createElement('span');
                correctIcon.classList.add('feedback-icon');
                correctIcon.textContent = '✔';
                correctIcon.style.marginRight = '10px';
                correctIcon.style.fontWeight = 'bold';
                correctIcon.style.color = '#28a745';
                correctOptionElement.insertBefore(correctIcon, correctOptionElement.firstChild);
            }
        }

        // Store the currently selected element
        this.selectedOptionElement = selectedOptionElement;

        // Record event if enabled
        if (this._record) {
            window._ui_record_event({
                "event": "multiple_choice",
                "question": this._question,
                "selected_answer": selectedOption,
                "correct_answer": this._answer,
                "correct": correct,
                "points": correct ? this._points : 0
            });
        }

        // Dispatch custom event
        this.dispatchEvent(new CustomEvent('answerSelected', {
            detail: {
                correct,
                selectedAnswer: selectedOption,
                correctAnswer: this._answer,
                points: correct ? this._points : 0,
                question: this._question
            }
        }));
    }

    reset() {
        this.answered = false;
        this.selectedOptionElement = null;
        this.render();
    }
}

// Register the multiple choice component
customElements.define('ui-multiple-choice', UIMultipleChoice);

// Multiple Choice Group Component
class UIMultipleChoiceGroup extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'record', 'grade', 'show_feedback', 'card'];
    }

    constructor() {
        super();
        this._title = this.getAttribute('title') || 'Quiz';
        this._record = this.getAttribute('record') === 'true';
        this._grade = this.getAttribute('grade') === 'true';
        this._showFeedback = this.getAttribute('show_feedback') !== 'false'; // Default to true
        this._card = this.getAttribute('card') !== 'false'; // Default to true
        this._content = null;
        this.rendered = false;
        
        // Quiz state variables
        this.currentIndex = -1; // Start at -1 to show the start screen
        this.results = [];
        this.incorrectIndices = [];
        this.questionIndices = [];
        this.questionMap = new Map();
        this.originalQuestions = [];
        
        // Bind event handler
        this._handleAnswerSelected = this._handleAnswerSelected.bind(this);
    }

    get title() {
        return this._title;
    }

    set title(value) {
        this._title = value;
        if (this.rendered) this.renderStartPage();
    }

    get record() {
        return this._record;
    }

    set record(value) {
        this._record = value === 'true' || value === true;
    }

    get grade() {
        return this._grade;
    }

    set grade(value) {
        this._grade = value === 'true' || value === true;
    }

    get showFeedback() {
        return this._showFeedback;
    }

    set showFeedback(value) {
        this._showFeedback = value !== 'false' && value !== false;
    }

    get card() {
        return this._card;
    }

    set card(value) {
        this._card = value !== 'false' && value !== false && value !== 'none';
    }

    get content() {
        return this._content;
    }

    set content(value) {
        this._content = value;
        this.createQuestionsFromContent();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        // Parse child ui-multiple-choice elements if present
        const childQuestions = Array.from(this.querySelectorAll('ui-multiple-choice'));
        if (childQuestions.length > 0) {
            childQuestions.forEach((child, index) => {
                const id = `question-${index}`;
                child.setAttribute('data-id', id);
                child.setAttribute('show_feedback', 'false'); // Suppress feedback on individual questions
                child.setAttribute('card', 'none'); // No card for individual questions in group
                this.questionMap.set(id, child.outerHTML);
                this.originalQuestions.push(child);
            });
            this.resetQuestionIndices();
        }
        this.renderStartPage();
        this.rendered = true;
    }

    createQuestionsFromContent() {
        if (this._content) {
            this.originalQuestions = this._content.map((item, index) => {
                let element;
                if (item instanceof HTMLElement) {
                    element = item;
                } else if (Array.isArray(item)) {
                    const [question, options, answer, points] = item;
                    element = this.createMCQElement({ question, options, answer, points });
                } else if (typeof item === 'object') {
                    element = this.createMCQElement(item);
                }
                const id = `question-${index}`;
                element.setAttribute('data-id', id);
                element.setAttribute('show_feedback', 'false'); // Suppress feedback on individual questions
                element.setAttribute('card', 'none'); // No card for individual questions in group
                this.questionMap.set(id, element.outerHTML);
                return element;
            });
            this.resetQuestionIndices();
        }
    }

    resetQuestionIndices() {
        this.questionIndices = this.originalQuestions.map((_, index) => `question-${index}`);
    }

    createMCQElement({ question, options, answer, points = 1, src = null }) {
        const mcElement = document.createElement('ui-multiple-choice');
        mcElement.setAttribute('question', question);
        mcElement.setAttribute('options', JSON.stringify(options));
        mcElement.setAttribute('answer', answer);
        mcElement.setAttribute('points', points.toString());
        if (src) mcElement.setAttribute('src', src);
        return mcElement;
    }

    addQuestion(questionData) {
        const index = this.originalQuestions.length;
        let element;

        if (questionData instanceof HTMLElement) {
            element = questionData;
        } else if (Array.isArray(questionData)) {
            const [question, options, answer, points] = questionData;
            element = this.createMCQElement({ question, options, answer, points });
        } else if (typeof questionData === 'object') {
            element = this.createMCQElement(questionData);
        }

        const id = `question-${index}`;
        element.setAttribute('data-id', id);
        element.setAttribute('show_feedback', 'false');
        element.setAttribute('card', 'none');
        
        this.questionMap.set(id, element.outerHTML);
        this.originalQuestions.push(element);
        this.questionIndices.push(id);
    }

    renderStartPage() {
        this.innerHTML = '';

        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.justifyContent = 'center';
        container.style.alignItems = 'center';
        container.style.height = '200px';
        container.style.padding = '20px';

        if (this._card) {
            container.style.border = '1px solid #ddd';
            container.style.borderRadius = '8px';
            container.style.backgroundColor = '#f9f9f9';
            container.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }

        const titleElement = document.createElement('h2');
        titleElement.textContent = this._title;
        titleElement.style.marginBottom = '20px';
        titleElement.style.color = '#333';
        container.appendChild(titleElement);

        const startButton = document.createElement(buttonTag);
        startButton.textContent = 'Start Quiz';
        startButton.style.padding = '10px 20px';
        startButton.style.fontSize = '16px';
        startButton.style.cursor = 'pointer';
        startButton.addEventListener('click', () => this.startQuiz());
        container.appendChild(startButton);

        this.appendChild(container);
    }

    startQuiz(questionsToRedo = null) {
        this.currentIndex = 0;
        this.results = [];
        this.incorrectIndices = [];

        if (questionsToRedo) {
            this.questionIndices = [...questionsToRedo];
        } else {
            this.resetQuestionIndices();
        }

        this.showCurrentQuestion();
    }

    showCurrentQuestion() {
        if (this.currentIndex >= this.questionIndices.length) {
            this.renderResults();
            return;
        }

        this.innerHTML = '';
        const questionId = this.questionIndices[this.currentIndex];
        const questionHTML = this.questionMap.get(questionId);

        const currentQuestion = document.createElement('div');
        currentQuestion.innerHTML = questionHTML;
        const mcqElement = currentQuestion.firstElementChild;

        const questionContainer = document.createElement('div');
        questionContainer.style.padding = '15px';
        questionContainer.style.marginBottom = '10px';

        if (this._card) {
            questionContainer.style.border = '1px solid #ddd';
            questionContainer.style.borderRadius = '8px';
            questionContainer.style.backgroundColor = '#f9f9f9';
            questionContainer.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }

        questionContainer.appendChild(mcqElement);
        mcqElement.addEventListener('answerSelected', this._handleAnswerSelected);

        this.appendChild(questionContainer);
    }

    _handleAnswerSelected(event) {
        const correct = event.detail.correct;
        const questionId = this.questionIndices[this.currentIndex];
        
        // Find the original question by matching the data-id
        const originalIndex = parseInt(questionId.replace('question-', ''));
        const currentQuestion = this.originalQuestions[originalIndex];

        this.results.push({
            id: questionId,
            question: currentQuestion.getAttribute('question'),
            selectedAnswer: event.detail.selectedAnswer,
            correctAnswer: currentQuestion.getAttribute('answer'),
            points: event.detail.points,
            correct: correct
        });

        if (!correct) {
            this.incorrectIndices.push(questionId);
        }

        if (this._showFeedback) {
            setTimeout(() => {
                this.currentIndex++;
                this.showCurrentQuestion();
            }, 300);
        } else {
            this.currentIndex++;
            this.showCurrentQuestion();
        }
    }

    calculateGrade(correctCount) {
        const percentage = (correctCount / this.questionIndices.length) * 100;
        if (percentage >= 90) return 'A';
        if (percentage >= 80) return 'B';
        if (percentage >= 70) return 'C';
        if (percentage >= 60) return 'D';
        if (percentage >= 50) return 'E';
        return 'F';
    }

    renderResults() {
        this.innerHTML = '';

        const container = document.createElement('div');
        container.style.padding = '20px';

        if (this._card) {
            container.style.border = '1px solid #ddd';
            container.style.borderRadius = '8px';
            container.style.backgroundColor = '#f9f9f9';
            container.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }

        const titleElement = document.createElement('h2');
        titleElement.textContent = 'Quiz Results';
        titleElement.style.marginBottom = '20px';
        titleElement.style.color = '#333';
        container.appendChild(titleElement);

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.marginBottom = '20px';

        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">Question</th><th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">You Answered</th><th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">Correct Answer</th>';
        table.appendChild(headerRow);

        let correctCount = 0;
        let totalPoints = 0;
        this.results.forEach((result) => {
            const resultRow = document.createElement('tr');

            const questionCell = document.createElement('td');
            questionCell.textContent = result.question;
            questionCell.style.border = '1px solid #ddd';
            questionCell.style.padding = '8px';

            const yourAnswerCell = document.createElement('td');
            yourAnswerCell.textContent = result.selectedAnswer;
            yourAnswerCell.style.border = '1px solid #ddd';
            yourAnswerCell.style.padding = '8px';
            yourAnswerCell.style.color = result.correct ? 'green' : 'red';

            const correctAnswerCell = document.createElement('td');
            correctAnswerCell.textContent = result.correctAnswer;
            correctAnswerCell.style.border = '1px solid #ddd';
            correctAnswerCell.style.padding = '8px';

            resultRow.appendChild(questionCell);
            resultRow.appendChild(yourAnswerCell);
            resultRow.appendChild(correctAnswerCell);

            if (result.correct) {
                correctCount++;
                totalPoints += result.points;
            }
            table.appendChild(resultRow);
        });

        container.appendChild(table);

        const summary = document.createElement('div');
        summary.textContent = `You got ${correctCount} out of ${this.questionIndices.length} correct. Total points: ${totalPoints}.`;
        summary.style.marginBottom = '10px';
        summary.style.fontWeight = 'bold';
        container.appendChild(summary);

        if (this._grade) {
            const grade = this.calculateGrade(correctCount);
            const gradeSummary = document.createElement('div');
            gradeSummary.textContent = `Your grade is: ${grade}`;
            gradeSummary.style.marginBottom = '20px';
            gradeSummary.style.fontWeight = 'bold';
            container.appendChild(gradeSummary);
        }

        const retryButton = document.createElement(buttonTag);
        retryButton.textContent = 'Retry Quiz';
        retryButton.style.marginTop = '20px';
        retryButton.style.marginRight = '10px';
        retryButton.style.padding = '10px 20px';
        retryButton.addEventListener('click', () => this.startQuiz());
        container.appendChild(retryButton);

        if (this.incorrectIndices.length > 0) {
            const redoButton = document.createElement(buttonTag);
            redoButton.textContent = 'Redo Incorrect Questions';
            redoButton.style.marginTop = '20px';
            redoButton.style.padding = '10px 20px';
            redoButton.addEventListener('click', () => this.startQuiz(this.incorrectIndices));
            container.appendChild(redoButton);
        }

        this.appendChild(container);

        if (this._record) {
            this.recordResults();
        }
    }

    recordResults() {
        console.log('Recording results:', this.results);
        if (window._ui_record_event) {
            window._ui_record_event({
                "event": "multiple_choice_group_results",
                "results": this.results,
                "total_questions": this.questionIndices.length,
                "correct_count": this.results.filter(r => r.correct).length,
                "total_points": this.results.reduce((sum, r) => sum + (r.correct ? r.points : 0), 0)
            });
        }
    }
}

// Register the multiple choice group component
customElements.define('ui-multiple-choice-group', UIMultipleChoiceGroup);

// Essay Question Component
class UIEssay extends HTMLElement {
    static get observedAttributes() {
        return ['question', 'context', 'grade', 'card'];
    }

    constructor() {
        super();
        this._question = this.getAttribute('question') || '';
        this._context = this.getAttribute('context') || '';
        this._grade = this.getAttribute('grade') !== 'false'; // Default to true
        this._card = this.getAttribute('card') !== 'false'; // Default to true
        this.rendered = false;
    }

    get question() {
        return this._question;
    }

    set question(value) {
        this._question = value;
        if (this.rendered) this.render();
    }

    get context() {
        return this._context;
    }

    set context(value) {
        this._context = value;
    }

    get grade() {
        return this._grade;
    }

    set grade(value) {
        this._grade = value !== 'false' && value !== false;
    }

    get card() {
        return this._card;
    }

    set card(value) {
        this._card = value !== 'false' && value !== false && value !== 'none';
        if (this.rendered) this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        this.render();
        this.rendered = true;
    }

    render() {
        this.innerHTML = '';

        // Main container
        const container = document.createElement('div');
        container.style.padding = '20px';
        container.style.fontFamily = 'Arial, sans-serif';

        if (this._card) {
            container.style.border = '1px solid #ddd';
            container.style.borderRadius = '8px';
            container.style.backgroundColor = '#f9f9f9';
            container.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }

        // Question text
        const questionElement = document.createElement('p');
        questionElement.textContent = this._question;
        questionElement.style.fontWeight = 'bold';
        questionElement.style.fontSize = '1.1em';
        questionElement.style.marginBottom = '15px';
        questionElement.style.color = '#333';
        container.appendChild(questionElement);

        // Textarea for answer
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Type your answer here...';
        textarea.style.width = '100%';
        textarea.style.height = '150px';
        textarea.style.padding = '10px';
        textarea.style.border = '1px solid #ccc';
        textarea.style.borderRadius = '4px';
        textarea.style.fontFamily = 'Arial, sans-serif';
        textarea.style.fontSize = '14px';
        textarea.style.resize = 'vertical';
        textarea.style.marginBottom = '15px';
        container.appendChild(textarea);

        // Submit button
        const submitButton = document.createElement(buttonTag);
        submitButton.textContent = 'Submit';
        submitButton.style.padding = '10px 20px';
        submitButton.style.fontSize = '16px';
        submitButton.style.cursor = 'pointer';
        submitButton.style.backgroundColor = '#007bff';
        submitButton.style.color = 'white';
        submitButton.style.border = 'none';
        submitButton.style.borderRadius = '4px';
        submitButton.style.marginBottom = '15px';
        submitButton.addEventListener('click', () => this.submitAnswer(textarea));
        container.appendChild(submitButton);

        // Response area
        const responseElement = document.createElement('p');
        responseElement.id = 'response';
        responseElement.style.marginBottom = '10px';
        responseElement.style.fontWeight = 'bold';
        container.appendChild(responseElement);

        // Score area
        const scoreElement = document.createElement('p');
        scoreElement.id = 'score';
        scoreElement.style.fontWeight = 'bold';
        scoreElement.style.color = '#28a745';
        container.appendChild(scoreElement);

        this.appendChild(container);
    }

    async submitAnswer(textarea) {
        const answer = textarea.value.trim();
        const responseElement = this.querySelector('#response');
        const scoreElement = this.querySelector('#score');

        if (!answer) {
            responseElement.textContent = 'Please enter an answer before submitting.';
            responseElement.style.color = '#dc3545';
            return;
        }

        // Show loading state
        responseElement.textContent = 'Evaluating...';
        responseElement.style.color = '#007bff';
        scoreElement.textContent = '';

        try {
            // Send the question, answer, context, and grade flag to Anvil
            const response = await fetch('https://beditor.anvil.app/_/api/evaluate_answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: this._question,
                    answer: answer,
                    context: this._context,
                    grade: this._grade
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const responseText = await response.text();
                console.warn('API returned non-JSON response:', responseText);
                throw new Error(`API returned invalid response format: ${responseText}`);
            }

            const evaluation = await response.json();

            // Display the evaluation feedback and score
            responseElement.textContent = `Evaluation: ${evaluation.feedback}`;
            responseElement.style.color = '#28a745';

            if (this._grade && evaluation.score) {
                scoreElement.textContent = `Score: ${evaluation.score}/100`;
            }

            // Record event if enabled
            if (window._ui_record_event) {
                window._ui_record_event({
                    "event": "essay_submitted",
                    "question": this._question,
                    "answer": answer,
                    "feedback": evaluation.feedback,
                    "score": evaluation.score || null,
                    "context": this._context
                });
            }

        } catch (error) {
            // If it's a network or API error, show a fallback message
            if (error.message.includes('fetch') || error.message.includes('HTTP error') || error.message.includes('API returned')) {
                responseElement.textContent = 'Essay submitted successfully! (API evaluation temporarily unavailable)';
                responseElement.style.color = '#28a745';
                
                // Record the submission even if API fails
                if (window._ui_record_event) {
                    window._ui_record_event({
                        "event": "essay_submitted",
                        "question": this._question,
                        "answer": answer,
                        "feedback": "Submitted (API unavailable)",
                        "score": null,
                        "context": this._context
                    });
                }
            } else {
                responseElement.textContent = 'Error occurred while submitting: ' + error.message;
                responseElement.style.color = '#dc3545';
            }
            
            console.error('Essay submission error:', error);
            
            // Log the request details for debugging
            console.log('Request details:', {
                question: this._question,
                answer: answer,
                context: this._context,
                grade: this._grade,
                origin: window.location.origin,
                referrer: document.referrer
            });
        }
    }
}

// Register the essay component
customElements.define('ui-essay', UIEssay);

// Whiteboard Component
class UIWhiteboard extends HTMLElement {
    static get observedAttributes() {
        return ['width', 'height', 'stroke_color', 'stroke_width', 'background_color'];
    }

    constructor() {
        super();
        this._width = parseInt(this.getAttribute('width')) || 500;
        this._height = parseInt(this.getAttribute('height')) || 500;
        this._strokeColor = this.getAttribute('stroke_color') || 'black';
        this._strokeWidth = parseInt(this.getAttribute('stroke_width')) || 2;
        this._backgroundColor = this.getAttribute('background_color') || 'white';
        
        this.paths = [];
        this.drawing = false;
        this.currentPath = null;
        this.currentPathData = '';
        this.svg = null;
        this.rendered = false;
    }

    get width() {
        return this._width;
    }

    set width(value) {
        this._width = parseInt(value) || 500;
        if (this.rendered && this.svg) {
            this.svg.setAttribute('width', this._width);
        }
    }

    get height() {
        return this._height;
    }

    set height(value) {
        this._height = parseInt(value) || 500;
        if (this.rendered && this.svg) {
            this.svg.setAttribute('height', this._height);
        }
    }

    get strokeColor() {
        return this._strokeColor;
    }

    set strokeColor(value) {
        this._strokeColor = value;
    }

    get strokeWidth() {
        return this._strokeWidth;
    }

    set strokeWidth(value) {
        this._strokeWidth = parseInt(value) || 2;
    }

    get backgroundColor() {
        return this._backgroundColor;
    }

    set backgroundColor(value) {
        this._backgroundColor = value;
        if (this.rendered && this.svg) {
            this.svg.style.backgroundColor = this._backgroundColor;
        }
    }

    attributeChangedCallback(name, oldValue, newValue) {
        this[name] = newValue;
        if (this.rendered) this.render();
    }

    connectedCallback() {
        console.log('UIWhiteboard connectedCallback called');
        this.render();
        this.rendered = true;
        console.log('UIWhiteboard rendered');
    }

    render() {
        console.log('UIWhiteboard render called');
        this.innerHTML = '';

        // Main container
        const container = document.createElement('div');
        container.classList.add("card-default");

        // Create SVG element
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svg.setAttribute("width", this._width);
        this.svg.setAttribute("height", this._height);
        this.svg.style.border = '1px solid #ccc';
        this.svg.style.backgroundColor = this._backgroundColor;
        this.svg.style.cursor = 'crosshair';
        this.svg.style.display = 'block';
        this.svg.style.margin = '0 auto';

        // Bind event listeners
        this.svg.addEventListener('mousedown', this.startDrawing.bind(this));
        this.svg.addEventListener('mousemove', this.draw.bind(this));
        this.svg.addEventListener('mouseup', this.stopDrawing.bind(this));
        this.svg.addEventListener('mouseleave', this.stopDrawing.bind(this));

        // Controls container
        const controlsContainer = document.createElement('div');
        controlsContainer.style.marginTop = '10px';
        controlsContainer.style.textAlign = 'center';

        // Clear button
        const clearButton = document.createElement(buttonTag);
        clearButton.textContent = 'Clear';
        clearButton.style.marginRight = '10px';
        clearButton.style.padding = '8px 16px';
        clearButton.style.cursor = 'pointer';
        clearButton.addEventListener('click', () => this.clear());
        controlsContainer.appendChild(clearButton);

        // Playback button
        const playbackButton = document.createElement(buttonTag);
        playbackButton.textContent = 'Playback';
        playbackButton.style.marginRight = '10px';
        playbackButton.style.padding = '8px 16px';
        playbackButton.style.cursor = 'pointer';
        playbackButton.addEventListener('click', () => this.playBack());
        controlsContainer.appendChild(playbackButton);

        // Download button
        const downloadButton = document.createElement(buttonTag);
        downloadButton.textContent = 'Download';
        downloadButton.style.padding = '8px 16px';
        downloadButton.style.cursor = 'pointer';
        downloadButton.addEventListener('click', () => this.download());
        controlsContainer.appendChild(downloadButton);

        container.appendChild(this.svg);
        container.appendChild(controlsContainer);
        this.appendChild(container);
        console.log('UIWhiteboard render completed');
    }

    startDrawing(event) {
        this.drawing = true;
        this.currentPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.currentPath.setAttribute("fill", "none");
        this.currentPath.setAttribute("stroke", this._strokeColor);
        this.currentPath.setAttribute("stroke-width", this._strokeWidth);
        
        const rect = this.svg.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        this.currentPathData = `M${x},${y}`;
        this.currentPath.setAttribute("d", this.currentPathData);
        this.svg.appendChild(this.currentPath);
    }

    draw(event) {
        if (!this.drawing) return;
        
        const rect = this.svg.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        this.currentPathData += ` L${x},${y}`;
        this.currentPath.setAttribute("d", this.currentPathData);
    }

    stopDrawing() {
        if (!this.drawing) return;
        this.drawing = false;
        this.paths.push(this.currentPathData);
    }

    clear() {
        this.svg.innerHTML = '';
        this.paths = [];
        this.drawing = false;
        this.currentPath = null;
        this.currentPathData = '';
    }

    playBack() {
        if (this.paths.length === 0) return;
        
        this.svg.innerHTML = ''; // Clear current drawing
        let index = 0;
        
        const drawPath = () => {
            if (index >= this.paths.length) return;
            
            const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
            pathElement.setAttribute("fill", "none");
            pathElement.setAttribute("stroke", this._strokeColor);
            pathElement.setAttribute("stroke-width", this._strokeWidth);
            pathElement.setAttribute("d", this.paths[index]);
            this.svg.appendChild(pathElement);
            
            index++;
            setTimeout(drawPath, 200); // Adjust this timeout for playback speed
        };
        
        drawPath();
    }

    download() {
        // Create a temporary SVG with the current drawing
        const tempSvg = this.svg.cloneNode(true);
        tempSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        
        // Convert SVG to data URL
        const svgData = new XMLSerializer().serializeToString(tempSvg);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        
        // Create download link
        const downloadLink = document.createElement('a');
        downloadLink.href = svgUrl;
        downloadLink.download = 'whiteboard-drawing.svg';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(svgUrl);
    }
}

// Register the whiteboard component
console.log('Registering ui-whiteboard component');
customElements.define('ui-whiteboard', UIWhiteboard);
console.log('ui-whiteboard component registered');

// Message Pill Component
class UIMessage extends HTMLElement {
    static get observedAttributes() {
        return ['kind', 'message', 'title', 'markdown', 'background_color', 'font_size', 'text_color', 'icon', 'center', 'width', 'padding'];
    }

    constructor() {
        super();
        this._kind = this.getAttribute('kind') || 'info';
        this._message = this.getAttribute('message') || '';
        this._title = this.getAttribute('title') || '';
        this._markdown = this.getAttribute('markdown') !== 'false'; // Default to true
        this._background_color = this.getAttribute('background_color') || '';
        this._font_size = this.getAttribute('font_size') || '';
        this._text_color = this.getAttribute('text_color') || '';
        this._icon = this.getAttribute('icon') || '';
        this._center = this.getAttribute('center') === 'true';
        this._width = this.getAttribute('width') || '';
        this._padding = this.getAttribute('padding') || '0.75em 1em';
        this.rendered = false;
    }

    get kind() {
        return this._kind;
    }

    set kind(value) {
        this._kind = value;
        if (this.rendered) this.render();
    }

    get message() {
        return this._message;
    }

    set message(value) {
        this._message = value;
        if (this.rendered) this.render();
    }

    get title() {
        return this._title;
    }

    set title(value) {
        this._title = value;
        if (this.rendered) this.render();
    }

    get markdown() {
        return this._markdown;
    }

    set markdown(value) {
        this._markdown = value !== 'false' && value !== false;
        if (this.rendered) this.render();
    }

    get background_color() {
        return this._background_color;
    }

    set background_color(value) {
        this._background_color = value;
        if (this.rendered) this.render();
    }

    get font_size() {
        return this._font_size;
    }

    set font_size(value) {
        this._font_size = value;
        if (this.rendered) this.render();
    }

    get text_color() {
        return this._text_color;
    }

    set text_color(value) {
        this._text_color = value;
        if (this.rendered) this.render();
    }

    get icon() {
        return this._icon;
    }

    set icon(value) {
        this._icon = value;
        if (this.rendered) this.render();
    }

    get center() {
        return this._center;
    }

    set center(value) {
        this._center = value === 'true' || value === true;
        if (this.rendered) this.render();
    }

    get width() {
        return this._width;
    }

    set width(value) {
        this._width = value;
        if (this.rendered) this.render();
    }

    get padding() {
        return this._padding;
    }

    set padding(value) {
        this._padding = value;
        if (this.rendered) this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        this[name] = newValue;
        if (this.rendered) this.render();
    }

    connectedCallback() {
        console.log('UIMessage connectedCallback called');
        this.render();
        this.rendered = true;
        console.log('UIMessage rendered');
    }

    render() {
        console.log('UIMessage render called');
        this.innerHTML = '';

        // Determine styles based on kind and attributes
        const styles = this.getStyles();
        
        // Main container
        const container = document.createElement('div');
        container.classList.add("card-default");
        container.style.display = 'flex';
        container.style.alignItems = this._center ? 'center' : 'flex-start';
        container.style.justifyContent = this._center ? 'center' : 'flex-start';
        container.style.padding = this._padding;
        container.style.borderRadius = '1.5em';
        container.style.fontSize = styles.fontSize;
        container.style.margin = '1em 0';
        container.style.backgroundColor = styles.backgroundColor;
        container.style.color = styles.textColor;
        
        if (this._center) {
            container.style.flexDirection = 'column';
            container.style.textAlign = 'center';
        }
        
        if (this._width) {
            container.style.width = this._width;
        }

        // Icon container
        const iconContainer = document.createElement('div');
        iconContainer.style.flexShrink = '0';
        iconContainer.style.width = '30px';
        iconContainer.style.marginRight = '0.5em';
        iconContainer.style.display = styles.showIcon ? 'flex' : 'none';
        iconContainer.style.justifyContent = 'flex-start';
        iconContainer.style.alignItems = 'center';

        // Icon element
        const iconElement = document.createElement('span');
        iconElement.innerHTML = styles.icon;
        iconContainer.appendChild(iconElement);

        // Text container
        const textContainer = document.createElement('div');
        textContainer.style.flexGrow = '1';
        textContainer.style.paddingTop = '0.1em';

        // Title element
        if (this._title) {
            const titleElement = document.createElement('div');
            titleElement.textContent = this._title;
            titleElement.style.fontWeight = 'bold';
            titleElement.style.marginBottom = '0.5em';
            titleElement.style.fontSize = 'inherit';
            textContainer.appendChild(titleElement);
        }

        // Message element
        const messageElement = document.createElement('div');
        messageElement.style.margin = '0';
        
        // Process message (markdown if enabled)
        const processedMessage = this._markdown ? this.processMarkdown(this._message) : this._message;
        messageElement.innerHTML = processedMessage;
        textContainer.appendChild(messageElement);

        // Assemble the component
        container.appendChild(iconContainer);
        container.appendChild(textContainer);
        this.appendChild(container);
    }

    getStyles() {
        let backgroundColor = this._background_color;
        let fontSize = this._font_size;
        let textColor = this._text_color;
        let icon = this._icon;
        let showIcon = true;

        // Apply default values for predefined kinds
        switch (this._kind) {
            case 'success':
                backgroundColor = backgroundColor || '#dff2bf';
                textColor = textColor || '#4f8a10';
                icon = icon || this.getIcon('success');
                break;
            case 'warning':
                backgroundColor = backgroundColor || '#feefb3';
                textColor = textColor || '#9f6000';
                icon = icon || this.getIcon('warning');
                break;
            case 'error':
                backgroundColor = backgroundColor || '#ffd2d2';
                textColor = textColor || '#d8000c';
                icon = icon || this.getIcon('error');
                break;
            case 'info':
                backgroundColor = backgroundColor || '#bde5f8';
                textColor = textColor || '#00529b';
                icon = icon || this.getIcon('info');
                break;
            case 'text':
                backgroundColor = backgroundColor || '#bde5f8';
                textColor = textColor || '#00529b';
                icon = 'none';
                showIcon = false;
                break;
            case 'title':
                backgroundColor = backgroundColor || '#bde5f8';
                textColor = textColor || '#00529b';
                fontSize = fontSize || '1.5em';
                icon = 'none';
                showIcon = false;
                break;
            case 'large title':
                backgroundColor = backgroundColor || '#bde5f8';
                textColor = textColor || '#00529b';
                fontSize = fontSize || '2em';
                icon = 'none';
                showIcon = false;
                break;
            case 'small title':
                backgroundColor = backgroundColor || '#bde5f8';
                textColor = textColor || '#00529b';
                fontSize = fontSize || '1.2em';
                icon = 'none';
                showIcon = false;
                break;
            default:
                backgroundColor = backgroundColor || '#bde5f8';
                textColor = textColor || '#00529b';
                icon = icon || this.getIcon('info');
                break;
        }

        return {
            backgroundColor,
            fontSize: fontSize || '1em',
            textColor,
            icon: icon === 'none' ? '' : icon,
            showIcon
        };
    }

    getIcon(kind) {
        const icons = {
            info: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>`,
            success: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="#4f8a10" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2l4 -4"/></svg>`,
            warning: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="#9f6000" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
            error: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="#d8000c" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="12" cy="12" r="9"/><path d="M10 10l4 4m0 -4l-4 4"/></svg>`
        };
        return icons[kind] || icons['info'];
    }

    processMarkdown(text) {
        // Simple markdown processing - can be enhanced with a proper markdown library
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }
}

// Register the message component
console.log('Registering ui-message component');
customElements.define('ui-message', UIMessage);
console.log('ui-message component registered');

// Poll Component
class UIPoll extends HTMLElement {
    static get observedAttributes() {
        return ['question', 'options', 'poll_id', 'use_cache', 'bar', 'bar_colors'];
    }

    constructor() {
        super();
        this._question = this.getAttribute('question') || "What's your favorite programming language?";
        this._options = JSON.parse(this.getAttribute('options') || '["JavaScript", "Python", "Java", "C++"]');
        this._pollId = this.getAttribute('poll_id') || this.generatePollId();
        this._useCache = this.getAttribute('use_cache') === 'true';
        this._bar = this.getAttribute('bar') !== 'false'; // Default to true
        this._barColors = JSON.parse(this.getAttribute('bar_colors') || '["#4caf50"]');
        
        this._votes = {};
        this._totalVotes = 0;
        this.rendered = false;
    }

    get question() {
        return this._question;
    }

    set question(value) {
        this._question = value;
        if (this.rendered) this.render();
    }

    get options() {
        return this._options;
    }

    set options(value) {
        this._options = Array.isArray(value) ? value : JSON.parse(value || '[]');
        if (this.rendered) this.render();
    }

    get pollId() {
        return this._pollId;
    }

    set pollId(value) {
        this._pollId = value;
    }

    get useCache() {
        return this._useCache;
    }

    set useCache(value) {
        this._useCache = value === 'true' || value === true;
    }

    get bar() {
        return this._bar;
    }

    set bar(value) {
        this._bar = value !== 'false' && value !== false;
        if (this.rendered) this.render();
    }

    get barColors() {
        return this._barColors;
    }

    set barColors(value) {
        this._barColors = Array.isArray(value) ? value : JSON.parse(value || '["#4caf50"]');
        if (this.rendered) this.render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        this[name] = newValue;
        if (this.rendered) this.render();
    }

    connectedCallback() {
        console.log('UIPoll connectedCallback called');
        // Use cache if enabled
        if (this._useCache && window._ui_app_df && window._ui_app_df[this.hexEncode(this._pollId, 'poll')]) {
            this._votes = window._ui_app_df[this.hexEncode(this._pollId, 'poll')];
            this._totalVotes = Object.values(this._votes).reduce((sum, value) => sum + value, 0);
            this.showResults();  // Immediately show results from cache
        } else {
            this.render();
        }
        this.rendered = true;
        console.log('UIPoll rendered');
    }

    generatePollId() {
        return 'poll_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    hexEncode(str, prefix) {
        const hexStr = Array.from(str)
            .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('');

        // Ensure the hex string starts with a letter by prepending 'a' if it starts with a number
        const safeHexStr = /^[0-9]/.test(hexStr) ? 'a' + hexStr : hexStr;

        return `${prefix}_${safeHexStr}`;
    }

    hexDecode(hexStr) {
        return hexStr.match(/.{1,2}/g)
            .map(byte => String.fromCharCode(parseInt(byte, 16)))
            .join('');
    }

    render() {
        console.log('UIPoll render called');
        this.innerHTML = '';

        // Main container
        const container = document.createElement('div');
        container.classList.add("card-default");

        // Question
        const questionDiv = document.createElement('div');
        questionDiv.textContent = this._question;
        questionDiv.style.fontWeight = 'bold';
        questionDiv.style.fontSize = '1.2em';
        questionDiv.style.marginBottom = '20px';
        questionDiv.style.color = '#333';
        container.appendChild(questionDiv);

        // Options
        this._options.forEach((option, index) => {
            const optionContainer = document.createElement('div');
            optionContainer.style.marginBottom = '10px';
            optionContainer.style.display = 'flex';
            optionContainer.style.alignItems = 'center';

            const radioButton = document.createElement('input');
            radioButton.type = 'radio';
            radioButton.name = 'poll-options';
            radioButton.value = option;
            radioButton.id = `option-${index}`;
            radioButton.style.marginRight = '10px';

            const label = document.createElement('label');
            label.htmlFor = `option-${index}`;
            label.textContent = option;
            label.style.cursor = 'pointer';

            optionContainer.appendChild(radioButton);
            optionContainer.appendChild(label);
            container.appendChild(optionContainer);
        });

        // Vote button
        const voteButton = document.createElement(buttonTag);
        voteButton.textContent = 'Vote';
        voteButton.disabled = true;
        voteButton.style.backgroundColor = 'rgba(0, 123, 255, 0.8)';
        voteButton.style.color = 'white';
        voteButton.style.border = 'none';
        voteButton.style.padding = '10px 15px';
        voteButton.style.borderRadius = '5px';
        voteButton.style.cursor = 'pointer';
        voteButton.style.marginTop = '15px';

        voteButton.addEventListener('click', () => this.submitVote());
        container.appendChild(voteButton);

        // Enable vote button when an option is selected
        this.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                voteButton.disabled = false;
                voteButton.style.backgroundColor = '#007BFF';
            });
        });

        this.appendChild(container);
    }

    submitVote() {
        const selectedOption = this.querySelector('input[type="radio"]:checked').value;

        // Hex encode poll ID and option before saving to cache or sending to server
        const pollIdHex = this.hexEncode(this._question, 'poll');
        const optionHex = this.hexEncode(selectedOption, 'option');

        // Update cache if enabled
        if (this._useCache) {
            if (!window._ui_app_df[pollIdHex]) {
                window._ui_app_df[pollIdHex] = {};
            }

            // Add vote to selected option in cache
            window._ui_app_df[pollIdHex][optionHex] = (window._ui_app_df[pollIdHex][optionHex] || 0) + 1;

            // Update local vote counts
            this._votes = window._ui_app_df[pollIdHex];
            this._totalVotes = Object.values(this._votes).reduce((sum, value) => sum + value, 0);

            this.showResults(); // Show cached results immediately
        }

        // Send vote to server with hex-encoded values
        const payload = {
            app_id: window.__app_id,
            name: pollIdHex,
            expression: `${pollIdHex}["${optionHex}"].add(1)`,
            return_variable: true
        };

        fetch("https://beditor.anvil.app/_/api/db_store", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        })
        .then(response => response.json())
        .then(result => {
            if (!this._useCache) {
                // Update votes from server if cache was not used
                this._votes = result.data;
                this._totalVotes = Object.values(this._votes).reduce((sum, value) => sum + value, 0);
                this.showResults();
            }
        })
        .catch(error => {
            console.error('Error submitting vote:', error);
        });
    }

    showResults() {
        this.innerHTML = '';

        // Main container
        const container = document.createElement('div');
        container.classList.add("card-default");

        const resultsContainer = document.createElement('div');

        // Question
        const questionDiv = document.createElement('div');
        questionDiv.textContent = this._question;
        questionDiv.style.fontWeight = 'bold';
        questionDiv.style.fontSize = '1.2em';
        questionDiv.style.marginBottom = '20px';
        questionDiv.style.color = '#333';
        resultsContainer.appendChild(questionDiv);

        // Create table elements only if bar is false
        let table, tbody;

        if (!this._bar) {
            // Create the table element
            table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';

            // Create the table header
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Option</th>
                    <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">Votes</th>
                    <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">Percentage</th>
                </tr>`;
            table.appendChild(thead);

            // Create the table body
            tbody = document.createElement('tbody');
        }

        // Decode hex-encoded options and show results
        this._options.forEach((option, index) => {
            const optionHex = this.hexEncode(option, 'option');
            const voteCount = this._votes[optionHex] || 0;
            const percentage = this._totalVotes > 0 ? Math.round((voteCount / this._totalVotes) * 100) : 0;

            if (this._bar) {
                const barContainer = document.createElement('div');
                barContainer.style.marginBottom = '10px';

                const bar = document.createElement('div');
                bar.style.height = '25px';
                bar.style.backgroundColor = this._barColors[index % this._barColors.length];
                bar.style.textAlign = 'right';
                bar.style.paddingRight = '5px';
                bar.style.paddingLeft = '10px';
                bar.style.color = 'white';
                bar.style.borderRadius = '5px';
                bar.style.marginBottom = '10px';
                bar.style.display = 'flex';
                bar.style.justifyContent = 'space-between';
                bar.style.alignItems = 'center';
                bar.style.width = `${percentage}%`;
                bar.innerHTML = `<span style="color: #333333;">${option}</span><span style="color: #333333;">${percentage}%</span>`;
                
                barContainer.appendChild(bar);
                resultsContainer.appendChild(barContainer);
            } else {
                // Add table rows for each option
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">${option}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${voteCount}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${percentage}%</td>
                `;
                tbody.appendChild(row);
            }
        });

        if (!this._bar) {
            // Append the tbody to the table
            table.appendChild(tbody);
            resultsContainer.appendChild(table);
        }

        // Total votes
        const totalVotesDiv = document.createElement('div');
        totalVotesDiv.textContent = `Total votes: ${this._totalVotes}`;
        totalVotesDiv.style.fontSize = '12px';
        totalVotesDiv.style.marginTop = '20px';
        totalVotesDiv.style.color = '#666';
        resultsContainer.appendChild(totalVotesDiv);

        container.appendChild(resultsContainer);

        // Back to Question button
        const backButton = document.createElement(buttonTag);
        backButton.textContent = 'Back to Question';
        backButton.style.backgroundColor = 'rgba(0, 123, 255, 0.8)';
        backButton.style.color = 'white';
        backButton.style.border = 'none';
        backButton.style.padding = '10px 15px';
        backButton.style.borderRadius = '5px';
        backButton.style.cursor = 'pointer';
        backButton.style.marginTop = '15px';

        backButton.addEventListener('click', () => this.render());
        container.appendChild(backButton);

        this.appendChild(container);
    }
}

// Register the poll component
console.log('Registering ui-poll component');
customElements.define('ui-poll', UIPoll);
console.log('ui-poll component registered');

// Test component creation
console.log('Testing component creation...');
try {
    const testWhiteboard = document.createElement('ui-whiteboard');
    console.log('Whiteboard created successfully:', testWhiteboard);
    
    const testMessage = document.createElement('ui-message');
    console.log('Message created successfully:', testMessage);
    
    const testPoll = document.createElement('ui-poll');
    console.log('Poll created successfully:', testPoll);
} catch (error) {
    console.error('Error creating components:', error);
}

class UIAccordion extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'content', 'background','markdown', 'math', 'html-content'];
    }

    constructor() {
        super();
        this._title = this.getAttribute('title') || '';
        this._content = null;
        this._markdown = this.getAttribute('markdown') !== 'false'; // Default to true
        this._math = this.getAttribute('math') !== 'false'; // Default to true
        this._background = this.getAttribute('background') || '';
        this._htmlContent = this.getAttribute('html-content') || '';
        this._initialized = false;
    }

    get title() {
        return this._title;
    }

    set title(value) {
        this._title = value;
        this.setAttribute('title', value);
        if (this._initialized) {
            this.updateAccordion();
        }
    }

    get content() {
        return this._content;
    }

    set content(value) {
        this._content = value;
        if (this._initialized) {
            this.updateAccordion();
        }
    }

    get markdown() {
        return this._markdown;
    }

    set markdown(value) {
        this._markdown = value;
        this.setAttribute('markdown', value ? 'true' : 'false');
        if (this._initialized) {
            this.updateAccordion();
        }
    }

    get math() {
        return this._math;
    }

    set math(value) {
        this._math = value;
        this.setAttribute('math', value ? 'true' : 'false');
        if (this._initialized) {
            this.updateAccordion();
        }
    }

    get background() {
        return this._background;
    }

    set background(value) {
        this._background = value;
        this.setAttribute('background', value);
        if (this._initialized) {
            this.updateBackground();
        }
    }

    get htmlContent() {
        return this._htmlContent;
    }

    set htmlContent(value) {
        this._htmlContent = value;
        this.setAttribute('html-content', value);
        if (this._initialized) {
            this.updateAccordion();
        }
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && this._initialized) {
            if (name === 'title') {
                this._title = newValue;
            } else if (name === 'markdown') {
                this._markdown = newValue !== 'false';
            } else if (name === 'math') {
                this._math = newValue !== 'false';
            } else if (name === 'background') {
                this._background = newValue;
                this.updateBackground();
            } else if (name === 'html-content') {
                this._htmlContent = newValue;
            }
            this.updateAccordion();
        }
    }

    connectedCallback() {
        console.log('[UIAccordion] Connected callback called');
        if (!this._initialized) {
            this._initialized = true;
            console.log('[UIAccordion] Initializing accordion');
            this.initializeAccordion();
        }
        console.log('[UIAccordion] Updating accordion');
        this.updateAccordion();
    }

    initializeAccordion() {
        console.log('[UIAccordion] Initializing accordion structure');
        this.extractInitialContent();

        // Create the <details> and <summary> elements
        this.detailsElement = document.createElement('details');
        this.detailsElement.open = false; // Start closed
        this.detailsElement.classList.add('card-default'); // Add class for styling

        this.summaryElement = document.createElement('summary');
        this.summaryElement.addEventListener('click', () => {
            console.log('[UIAccordion] Summary clicked, details open:', this.detailsElement.open);
        });
        this.detailsElement.appendChild(this.summaryElement);

        this.contentContainer = document.createElement('div');
        this.contentContainer.classList.add('content');
        this.contentContainer.style.maxHeight = '0px';
        this.contentContainer.style.opacity = '0';
        this.contentContainer.style.transform = 'translateY(-10px)';
        this.detailsElement.appendChild(this.contentContainer);

        // Append the details element to the component
        this.appendChild(this.detailsElement);
        
        // Add change event listener to track open/close state
        this.detailsElement.addEventListener('toggle', () => {
            console.log('[UIAccordion] Details toggled, open:', this.detailsElement.open);
        });
        
        console.log('[UIAccordion] Accordion structure created');
    }

    extractInitialContent() {
        if (this._content !== null) return;

        const nodes = Array.from(this.childNodes);
        console.log('[UIAccordion] Extracting initial content:', {
            nodeCount: nodes.length,
            nodes: nodes.map(n => ({ type: n.nodeType, content: n.textContent || n.nodeName }))
        });

        if (nodes.length === 1 && nodes[0].nodeType === Node.TEXT_NODE) {
            this._content = nodes[0].textContent.trim();
        } else if (nodes.length > 0) {
            // Store the content as a string if it's text content
            let hasTextContent = false;
            let textContent = '';
            
            nodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    hasTextContent = true;
                    textContent += node.textContent;
                }
            });
            
            if (hasTextContent) {
                this._content = textContent.trim();
            } else {
                // For non-text nodes, create a fragment
                const fragment = document.createDocumentFragment();
                nodes.forEach(node => fragment.appendChild(node.cloneNode(true)));
                this._content = fragment;
            }
        } else {
            this._content = '';
        }

        console.log('[UIAccordion] Extracted content:', this._content);

        // Clear the initial content to prevent double rendering
        this.innerHTML = '';
    }

    updateAccordion() {
        console.log('[UIAccordion] Updating accordion:', {
            title: this._title,
            content: this._content,
            contentType: typeof this._content,
            markdown: this._markdown,
            math: this._math
        });

        this.summaryElement.textContent = this._title;

        // Clear existing content
        this.contentContainer.innerHTML = '';

        // Determine what to display based on content type
        if (typeof this._content === 'string') {
            if (this._markdown) {
                // Use the proper ui-markdown component for markdown rendering
                const markdownElement = document.createElement('ui-markdown');
                markdownElement.setAttribute('math', this._math ? 'true' : 'false');
                markdownElement.content = this._content;
                this.contentContainer.appendChild(markdownElement);
            } else {
                const textElement = document.createElement('div');
                textElement.textContent = this._content;
                this.contentContainer.appendChild(textElement);
            }
        } else if (this._content instanceof Node) {
            const clonedContent = this._content.cloneNode(true);
            this.contentContainer.appendChild(clonedContent);
        }
        
        // If no content was added, show a placeholder
        if (this.contentContainer.children.length === 0) {
            const placeholderElement = document.createElement('div');
            placeholderElement.textContent = 'No content to display';
            placeholderElement.style.color = '#999';
            placeholderElement.style.fontStyle = 'italic';
            this.contentContainer.appendChild(placeholderElement);
        }

        // Add HTML content if provided
        if (this._htmlContent) {
            try {
                const htmlWrapper = document.createElement('div');
                htmlWrapper.innerHTML = this._htmlContent;
                htmlWrapper.style.marginTop = '10px';
                this.contentContainer.appendChild(htmlWrapper);
            } catch (error) {
                console.error('Error parsing HTML content:', error);
            }
        }

        // Add elegant styling with smooth animations
        this.detailsElement.style.border = '1px solid #e9ecef';
        this.detailsElement.style.borderRadius = '12px';
        this.detailsElement.style.margin = '16px 0';
        this.detailsElement.style.overflow = 'hidden';
        this.detailsElement.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        this.detailsElement.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        
        // Preserve background color if it was set
        const savedBackground = this.detailsElement.getAttribute('data-background');
        if (savedBackground) {
            this.detailsElement.style.backgroundColor = savedBackground;
        } else {
            this.detailsElement.style.backgroundColor = '#ffffff';
        }
        
        this.summaryElement.style.padding = '15px 20px';
        
        // Preserve summary background color if background was set
        if (savedBackground) {
            const darkerColor = this.getDarkerShade(savedBackground);
            this.summaryElement.style.backgroundColor = darkerColor;
        } else {
            this.summaryElement.style.backgroundColor = '#f8f9fa';
        }
        
        this.summaryElement.style.cursor = 'pointer';
        this.summaryElement.style.fontWeight = '600';
        this.summaryElement.style.color = '#333';
        this.summaryElement.style.transition = 'background-color 0.3s ease, color 0.3s ease';
        this.summaryElement.style.userSelect = 'none';
        this.summaryElement.style.position = 'relative';
        
        // Add chevron indicator
        this.chevron = document.createElement('span');
        this.chevron.innerHTML = '▼';
        this.chevron.style.position = 'absolute';
        this.chevron.style.right = '20px';
        this.chevron.style.top = '50%';
        this.chevron.style.transform = 'translateY(-50%)';
        this.chevron.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        this.chevron.style.fontSize = '12px';
        this.chevron.style.color = '#666';
        this.summaryElement.appendChild(this.chevron);
        
        // Add hover effects - these will be updated by updateBackground if a custom background is set
        this.setupHoverEffects();
        
        this.contentContainer.style.padding = '20px';
        this.contentContainer.style.borderTop = '1px solid #e9ecef';
        
        // Preserve content background color if background was set
        const contentBackground = this.detailsElement.getAttribute('data-background');
        if (contentBackground) {
            this.contentContainer.style.backgroundColor = contentBackground;
        } else {
            this.contentContainer.style.backgroundColor = '#ffffff';
        }
        
        this.contentContainer.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        this.contentContainer.style.transformOrigin = 'top';
        
        // Add smooth slide animation
        this.setupSlideAnimation();
        
        // Apply background if set
        this.updateBackground();
        
        // Store the background color to prevent it from being overridden
        if (this._background) {
            this.detailsElement.setAttribute('data-background', this._background);
        }
    }

    updateBackground() {
        if (this._background) {
            // Apply background to the main accordion container
            this.detailsElement.style.backgroundColor = this._background;
            
            // Also apply a slightly darker version to the summary for contrast
            if (this.summaryElement) {
                // Create a darker shade of the background color
                const darkerColor = this.getDarkerShade(this._background);
                this.summaryElement.style.backgroundColor = darkerColor;
                
                // Update hover colors
                this.updateHoverEffects(darkerColor);
            }
        } else {
            // Reset to default colors
            this.detailsElement.style.backgroundColor = '#ffffff';
            if (this.summaryElement) {
                this.summaryElement.style.backgroundColor = '#f8f9fa';
                this.updateHoverEffects('#f8f9fa');
            }
        }
    }

    setupHoverEffects() {
        // Default hover effects
        this.updateHoverEffects('#f8f9fa');
    }

    updateHoverEffects(baseColor) {
        // Remove existing event listeners to prevent duplicates
        this.summaryElement.removeEventListener('mouseenter', this._mouseenterHandler);
        this.summaryElement.removeEventListener('mouseleave', this._mouseleaveHandler);
        
        // Create new handlers
        this._mouseenterHandler = () => {
            const hoverColor = this.getDarkerShade(baseColor);
            this.summaryElement.style.backgroundColor = hoverColor;
            this.summaryElement.style.color = '#000';
        };
        
        this._mouseleaveHandler = () => {
            this.summaryElement.style.backgroundColor = baseColor;
            this.summaryElement.style.color = '#333';
        };
        
        // Add new event listeners
        this.summaryElement.addEventListener('mouseenter', this._mouseenterHandler);
        this.summaryElement.addEventListener('mouseleave', this._mouseleaveHandler);
    }

    restoreBackgroundColors() {
        const savedBackground = this.detailsElement.getAttribute('data-background');
        if (savedBackground) {
            // Restore main container background
            this.detailsElement.style.backgroundColor = savedBackground;
            
            // Restore content container background
            this.contentContainer.style.backgroundColor = savedBackground;
            
            // Restore summary background (darker shade)
            const darkerColor = this.getDarkerShade(savedBackground);
            this.summaryElement.style.backgroundColor = darkerColor;
        }
    }

    // Method to add HTML elements to the accordion content
    addElement(element) {
        if (!this.contentContainer) {
            console.warn('Accordion not initialized yet');
            return;
        }

        // If element is a string, treat it as HTML
        if (typeof element === 'string') {
            const htmlWrapper = document.createElement('div');
            htmlWrapper.innerHTML = element;
            htmlWrapper.style.marginTop = '10px';
            this.contentContainer.appendChild(htmlWrapper);
        } else if (element instanceof HTMLElement) {
            // If element is an HTMLElement, clone and add it
            const clonedElement = element.cloneNode(true);
            clonedElement.style.marginTop = '10px';
            this.contentContainer.appendChild(clonedElement);
        } else {
            console.error('Invalid element type. Expected string (HTML) or HTMLElement');
        }
    }

    // Method to add multiple elements at once
    addElements(elements) {
        if (Array.isArray(elements)) {
            elements.forEach(element => this.addElement(element));
        } else {
            console.error('Expected array of elements');
        }
    }

    // Method to clear all content and start fresh
    clearContent() {
        if (this.contentContainer) {
            this.contentContainer.innerHTML = '';
        }
    }

    // Method to get all current content elements
    getContentElements() {
        if (this.contentContainer) {
            return Array.from(this.contentContainer.children);
        }
        return [];
    }

    getDarkerShade(color) {
        // Simple function to create a darker shade of a color
        // This is a basic implementation - you could use a more sophisticated color library
        if (color.startsWith('#')) {
            // For hex colors, reduce brightness by 20%
            const hex = color.slice(1);
            const r = Math.max(0, parseInt(hex.substr(0, 2), 16) * 0.8);
            const g = Math.max(0, parseInt(hex.substr(2, 2), 16) * 0.8);
            const b = Math.max(0, parseInt(hex.substr(4, 2), 16) * 0.8);
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        } else if (color.startsWith('rgb')) {
            // For rgb colors, reduce brightness by 20%
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                const r = Math.max(0, parseInt(match[1]) * 0.8);
                const g = Math.max(0, parseInt(match[2]) * 0.8);
                const b = Math.max(0, parseInt(match[3]) * 0.8);
                return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
            }
        }
        // Fallback for other color formats
        return '#e9ecef';
    }

    setupSlideAnimation() {
        // Override the default details behavior for smooth animations
        this.detailsElement.addEventListener('toggle', (event) => {
            event.preventDefault();
            
            if (this.detailsElement.open) {
                // Opening animation
                this.animateOpen();
            } else {
                // Closing animation
                this.animateClose();
            }
        });

        // Prevent default click behavior and handle manually
        this.summaryElement.addEventListener('click', (event) => {
            event.preventDefault();
            this.toggleAccordion();
        });
    }

    toggleAccordion() {
        const isOpen = this.detailsElement.open;
        
        if (isOpen) {
            this.animateClose();
        } else {
            this.animateOpen();
        }
    }

    animateOpen() {
        // Preserve background colors during animation
        const savedBackground = this.detailsElement.getAttribute('data-background');
        
        // Set initial state for opening animation
        this.contentContainer.style.maxHeight = '0px';
        this.contentContainer.style.opacity = '0';
        this.contentContainer.style.transform = 'translateY(-10px)';
        
        // Force a reflow
        this.contentContainer.offsetHeight;
        
        // Animate to open state
        this.contentContainer.style.maxHeight = this.contentContainer.scrollHeight + 'px';
        this.contentContainer.style.opacity = '1';
        this.contentContainer.style.transform = 'translateY(0)';
        
        // Animate chevron rotation
        this.chevron.style.transform = 'translateY(-50%) rotate(180deg)';
        
        // Mark as open
        this.detailsElement.open = true;
        
        // Clean up styles after animation
        setTimeout(() => {
            this.contentContainer.style.maxHeight = 'none';
            // Restore all background colors after animation
            this.restoreBackgroundColors();
        }, 500);
    }

    animateClose() {
        // Preserve background colors during animation
        const savedBackground = this.detailsElement.getAttribute('data-background');
        
        // Set closing animation state
        this.contentContainer.style.maxHeight = this.contentContainer.scrollHeight + 'px';
        
        // Force a reflow
        this.contentContainer.offsetHeight;
        
        // Animate to closed state
        this.contentContainer.style.maxHeight = '0px';
        this.contentContainer.style.opacity = '0';
        this.contentContainer.style.transform = 'translateY(-10px)';
        
        // Animate chevron rotation back
        this.chevron.style.transform = 'translateY(-50%) rotate(0deg)';
        
        // Mark as closed after animation
        setTimeout(() => {
            this.detailsElement.open = false;
            // Restore all background colors after animation
            this.restoreBackgroundColors();
        }, 500);
    }
}

// Register the custom element
customElements.define('ui-accordion', UIAccordion);

class UIMarkdown extends HTMLElement {
    static get observedAttributes() {
        return ['content', 'math', 'html', 'breaks', 'linkify', 'typographer', 'font'];
    }

    constructor() {
        super();

        // Initialize properties
        this._content = ''; // Initialize to an empty string
        this._math = false;
        this._html = true; // Default to true for HTML support in markdown
        this._breaks = false;
        this._linkify = false;
        this._typographer = false;
        this._font = "";  // New property for font

        // Initialize markdown-it with the required options
        this.md = window.markdownit({
            html: this._html,
            breaks: this._breaks,
            langPrefix: 'language-', // Static option, no need for attribute
            linkify: this._linkify,
            typographer: this._typographer,
        });

        // Apply markdown-it plugins if available
        if (window.markdownitAdmon) {
            this.md.use(window.markdownitAdmon);
        }
        if (window.markdownitContainer) {
            this.md.use(window.markdownitContainer, 'warning');
            this.md.use(window.markdownitContainer, 'info');
            this.md.use(window.markdownitContainer, 'success');
            this.md.use(window.markdownitContainer, 'error');
        }
    }

    // Getters and setters for observed attributes

    get content() {
        return this._content;
    }
    set content(value) {
        this._content = value;
        this.render();
    }

    get math() {
        return this._math;
    }
    set math(value) {
        this._math = String(value).toLowerCase() === 'true';
        this.render();
    }

    get html() {
        return this._html;
    }
    set html(value) {
        this._html = String(value).toLowerCase() === 'true';
        this.updateMarkdownItConfig();
        this.render();
    }

    get breaks() {
        return this._breaks;
    }
    set breaks(value) {
        this._breaks = String(value).toLowerCase() === 'true';
        this.updateMarkdownItConfig();
        this.render();
    }

    get linkify() {
        return this._linkify;
    }
    set linkify(value) {
        this._linkify = String(value).toLowerCase() === 'true';
        this.updateMarkdownItConfig();
        this.render();
    }

    get typographer() {
        return this._typographer;
    }
    set typographer(value) {
        this._typographer = String(value).toLowerCase() === 'true';
        this.updateMarkdownItConfig();
        this.render();
    }

    // New getter and setter for font
    get font() {
        return this._font;
    }
    set font(value) {
        this._font = value;
        this.render();
    }

    // Method to update the markdown-it configuration when options change
    updateMarkdownItConfig() {
        this.md.set({
            html: this._html,
            breaks: this._breaks,
            linkify: this._linkify,
            typographer: this._typographer,
        });
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'content') {
            this.content = newValue;
        } else if (name === 'math') {
            this.math = newValue;
        } else if (name === 'html') {
            this.html = newValue;
        } else if (name === 'breaks') {
            this.breaks = newValue;
        } else if (name === 'linkify') {
            this.linkify = newValue;
        } else if (name === 'typographer') {
            this.typographer = newValue;
        } else if (name === 'font') {
            this.font = newValue;
        }
    }

    connectedCallback() {
        if (typeof this._content !== 'string') {
            this._content = '';
        }
        if (!this.getAttribute('content') || !this._content.trim()) {
            this._content = this.innerHTML.trim();
        }
        if (!this.hasAttribute('html')) this.setAttribute('html', 'true');
        if (!this.hasAttribute('breaks')) this.setAttribute('breaks', 'false');
        if (!this.hasAttribute('linkify')) this.setAttribute('linkify', 'false');
        if (!this.hasAttribute('typographer')) this.setAttribute('typographer', 'false');
        this.render();
    }

    transformBlocks(text) {
        const newline = String.fromCharCode(10);
        const lines = text.split(newline);
        let transformedLines = [];
        let inBlock = false;
        let blockType = '';
        let blockContent = '';

        lines.forEach((line) => {
            const trimmedLine = line.trim();
            if (!inBlock && trimmedLine.startsWith('::: ') && trimmedLine.length > 4) {
                inBlock = true;
                blockType = trimmedLine.substring(4);
            } else if (inBlock && trimmedLine === ':::') {
                const firstWordInBlockType = blockType.split(' ')[0];
                transformedLines.push(
                    `<we-${firstWordInBlockType}>${blockContent.trim()}</we-${firstWordInBlockType}>`
                );
                inBlock = false;
                blockType = '';
                blockContent = '';
            } else if (inBlock) {
                blockContent += line + newline;
            } else {
                transformedLines.push(line);
            }
        });
        return transformedLines.join(newline);
    }

    render() {
        let markdownDiv = this.querySelector('.markdown-div');
        if (!markdownDiv) {
            markdownDiv = document.createElement('div');
            markdownDiv.className = 'markdown-div';
            this.appendChild(markdownDiv);
        }
        try {
            if (this.md) {
                const transformedContent = this.transformBlocks(this._content);
                const htmlContent = this.md.render(transformedContent);
                markdownDiv.innerHTML = htmlContent;
                if (this._math && window.MathJax) {
                    window.MathJax.typesetPromise([markdownDiv]).catch((err) =>
                        console.error(err.message)
                    );
                }
                // Apply the font if specified
                if (this._font) {
                    markdownDiv.style.fontFamily = this._font;
                }
            } else {
                markdownDiv.innerHTML = `<p>Error: Markdown-it is not initialized.</p>`;
            }
        } catch (e) {
            markdownDiv.innerHTML = `<p>Error rendering content: ${e.message}</p>`;
        }
    }
}

// Register the custom element
customElements.define('ui-markdown', UIMarkdown);

class UIFlashcard extends HTMLElement {
    static get observedAttributes() {
        return [
            'cards',
            'front',
            'back',
            'intro',
            'mode',
            'record',
            'retake',
            'autoplay',
            'front_duration_ms',
            'back_duration_ms',
            'speak',
            'speak_front',
            'speak_back',
            'speak_front_card',
            'speak_back_card',
            'lang_front',
            'lang_back',
            'flip_on_click',
            'width',
            'height',
            'theme',
            'center',
            'padding',
            'point_mode',
            'answer_region',
            'reveal-back-after',
            'show-answer',
            'immediate-retry',
            'layout',
            'reveal'
        ];
    }

    constructor() {
        super();
        this._cards = [];
        this._currentIndex = 0;
        this._flipped = false;
        this._mode = 'record';
        this._record = true;
        this._retake = true;
        this._immediateRetry = true;
        this._autoplay = false;
        this._frontDuration = 1500;
        this._backDuration = 1500;
        this._revealBackAfterSec = 0.5;
        this._showAnswerSec = 0.3;
        this._autoRevealTimer = null;
        this._hasAnsweredCurrentCard = false;
        this._pendingAdvanceTimer = null;
        this._speak = false;
        this._speakFront = false;
        this._speakBack = false;
        this._speakFrontCard = false;
        this._speakBackCard = true;
        this._langFront = 'en-GB';
        this._langBack = 'en-GB';
        this._flipOnClick = true;
        this._width = '';
        this._height = '';
        this._theme = 'default';
        this._center = true;
        this._padding = '1.25em 1.5em';
        this._pointMode = false;
        this._answerRegion = null;
        this._results = [];
        this._round = 1;
        this._roundStartTime = null;
        this._roundComplete = false;
        this._cardShownAt = null;
        this._autoTimer = null;
        this._imageClickPos = null;
        this._container = null;
        this._cardInner = null;
        this._frontEl = null;
        this._backEl = null;
        this._controlsEl = null;
        this._scoreEl = null;
        this._summaryEl = null;
        this._imageWrapperFront = null;
        this._imageWrapperBack = null;
        this._initialized = false;
        this._intro = '';
        this._introShown = false;

        // Layout and reveal
        this._layout = 'row'; // 'flip' | 'row' | 'column'
        this._reveal = 'manual'; // 'manual' | number (seconds for auto-reveal)
        this._answerRevealed = false;
        this._reversed = false;
        this._showOptionsPanel = false;

        // Spaced repetition state
        this._srEnabled = false;
        this._srDeckId = null;
        this._srDeckData = {};
        this._srSession = new Set(); // card IDs answered correctly this drill session
        this._originalCards = [];
        this._drillMode = false;
        this._smartOrder = false; // true when cards are SR-sorted

        this._onCardClick = this._onCardClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onImageClick = this._onImageClick.bind(this);
    }

    connectedCallback() {
        this._initFromAttributes();
        if (!this._initialized) {
            this._renderStructure();
            this._initialized = true;
        }
        this._initSR();
        // Auto-activate smart order on first load if user has prior SR data
        if (this._srEnabled && this._srDeckData &&
            Object.keys(this._srDeckData).length > 0 && !this._smartOrder) {
            this._applySROrder();
        }
        this._renderCurrentCard();
        if (this._autoplay || this._mode === 'auto') {
            this._scheduleAutoplay();
        }
    }

    disconnectedCallback() {
        if (this._autoTimer) {
            clearTimeout(this._autoTimer);
            this._autoTimer = null;
        }
        if (this._autoRevealTimer) {
            clearTimeout(this._autoRevealTimer);
            this._autoRevealTimer = null;
        }
        if (this._pendingAdvanceTimer) {
            clearTimeout(this._pendingAdvanceTimer);
            this._pendingAdvanceTimer = null;
        }
        this.removeEventListener('keydown', this._onKeyDown);
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        this._initFromAttributes();
        if (this._initialized) {
            this._renderCurrentCard();
        }
    }

    get cards() {
        return this._cards;
    }

    set cards(value) {
        if (Array.isArray(value)) {
            this._cards = value.map((c, idx) => ({
                front: String(c.front ?? ''),
                back: String(c.back ?? ''),
                id: c.id ?? idx
            }));
        } else {
            this._cards = [];
        }
        // Preserve original card order for retake-all and SR resets
        this._originalCards = this._cards.map((c) => ({ ...c }));
        this._currentIndex = 0;
        this._results = [];
        this._round = 1;
        this._roundStartTime = null;
        this._roundComplete = false;
        this._cardShownAt = null;
        this._drillMode = false;
        this._smartOrder = false;
        // Re-init SR with new deck
        if (this._initialized) {
            this._initSR();
            if (this._srEnabled && this._srDeckData &&
                Object.keys(this._srDeckData).length > 0) {
                this._applySROrder();
            }
        }
        if (this._initialized) this._renderCurrentCard();
    }

    _initFromAttributes() {
        const cardsAttr = this.getAttribute('cards');
        if (cardsAttr && !this._cards.length) {
            try {
                const parsed = JSON.parse(cardsAttr);
                if (Array.isArray(parsed)) this.cards = parsed;
            } catch (_) {}
        }
        if (!this._cards.length) {
            const front = this.getAttribute('front') || '';
            const back = this.getAttribute('back') || '';
            this._cards = [{ front, back, id: 0 }];
        }

        this._intro = this.getAttribute('intro') || '';
        this._introShown = !this._intro;

        const modeAttr = (this.getAttribute('mode') || '').toLowerCase();
        if (modeAttr === 'auto') this._mode = 'auto';
        else if (modeAttr === 'study') this._mode = 'study';
        else this._mode = 'record';
        this._record = this.getAttribute('record') !== 'false';
        this._autoplay = this.getAttribute('autoplay') === 'true' || this._mode === 'auto';

        this._frontDuration = parseInt(this.getAttribute('front-duration-ms') || '1500', 10) || 1500;
        this._backDuration = parseInt(this.getAttribute('back-duration-ms') || '1500', 10) || 1500;

        this._speak = this.getAttribute('speak') === 'true';
        this._speakFront = this.getAttribute('speak-front') === 'true';
        this._speakBack = this.getAttribute('speak-back') === 'true';
        this._speakFrontCard = this.getAttribute('speak-front-card') === 'true';
        const backCardAttr = this.getAttribute('speak-back-card');
        this._speakBackCard = backCardAttr === null ? true : backCardAttr === 'true';
        this._langFront = this.getAttribute('lang-front') || 'en-GB';
        this._langBack = this.getAttribute('lang-back') || 'en-GB';

        this._flipOnClick = this.getAttribute('flip-on-click') !== 'false';

        this._width = this.getAttribute('width') || '';
        this._height = this.getAttribute('height') || '';
        this._theme = this.getAttribute('theme') || 'default';
        this._center = this.getAttribute('center') !== 'false';
        this._padding = this.getAttribute('padding') || '1.25em 1.5em';

        this._pointMode = this.getAttribute('point-mode') === 'true';
        const region = this.getAttribute('answer-region');
        this._answerRegion = region ? this._parseRegion(region) : null;

        const retakeAttr = this.getAttribute('retake');
        this._retake = retakeAttr === null ? true : retakeAttr === 'true';

        const revealAttr = this.getAttribute('reveal-back-after');
        const revealVal = revealAttr !== null && revealAttr !== '' ? parseFloat(revealAttr) : 0.5;
        this._revealBackAfterSec = Number.isFinite(revealVal) && revealVal >= 0 ? revealVal : 0.5;

        const showAttr = this.getAttribute('show-answer');
        const showVal = showAttr !== null && showAttr !== '' ? parseFloat(showAttr) : 0.3;
        this._showAnswerSec = Number.isFinite(showVal) && showVal >= 0 ? showVal : 0.3;

        const immediateRetryAttr = this.getAttribute('immediate-retry');
        this._immediateRetry = immediateRetryAttr === null ? true : immediateRetryAttr === 'true';

        const layoutAttr = (this.getAttribute('layout') || '').toLowerCase();
        if (layoutAttr === 'flip' || layoutAttr === 'column') this._layout = layoutAttr;
        else this._layout = 'row';

        const revealAttrNew = (this.getAttribute('reveal') || '').toLowerCase();
        if (revealAttrNew === 'manual' || revealAttrNew === '') {
            this._reveal = 'manual';
        } else {
            const revealSec = parseFloat(revealAttrNew);
            this._reveal = Number.isFinite(revealSec) && revealSec > 0 ? revealSec : 'manual';
        }
    }

    _parseRegion(text) {
        const parts = String(text).split(',').map((p) => parseFloat(p.trim()));
        if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return null;
        return {
            x1: Math.min(Math.max(parts[0], 0), 1),
            y1: Math.min(Math.max(parts[1], 0), 1),
            x2: Math.min(Math.max(parts[2], 0), 1),
            y2: Math.min(Math.max(parts[3], 0), 1)
        };
    }

    _renderStructure() {
        this.innerHTML = '';
        this.tabIndex = 0;
        this.addEventListener('keydown', this._onKeyDown);

        // Inject focus-indication CSS once
        if (!document.getElementById('xp-flashcard-styles')) {
            const style = document.createElement('style');
            style.id = 'xp-flashcard-styles';
            style.textContent = `
                .xp-fc-btn { outline: none !important; transition: box-shadow 0.15s ease, transform 0.1s ease; }
                .xp-fc-btn:focus { outline: none !important; box-shadow: 0 0 0 3px var(--xp-fc-focus-color, rgba(100,116,139,0.45)); }
                .xp-fc-btn:hover { transform: translateY(-1px); }
                .xp-fc-btn.xp-fc-default { box-shadow: 0 0 0 2px var(--xp-fc-focus-color, rgba(100,116,139,0.45)); }
                .xp-fc-btn.xp-fc-default:focus { box-shadow: 0 0 0 4px var(--xp-fc-focus-color, rgba(100,116,139,0.45)); }
            `;
            document.head.appendChild(style);
        }

        const container = document.createElement('div');
        container.className = 'card-default';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'stretch';
        container.style.justifyContent = 'center';
        container.style.padding = '0.9rem 1.1rem';
        container.style.borderRadius = '1rem';
        container.style.boxShadow = '0 3px 10px rgba(15,23,42,0.14)';
        container.style.border = '1px solid rgba(148,163,184,0.5)';
        container.style.background = 'linear-gradient(145deg,#e5e7eb,#d1d5db)';
        container.style.margin = '1.2em auto';
        container.style.maxWidth = this._width || '360px';
        if (this._width) container.style.width = this._width;
        if (this._height) container.style.minHeight = this._height;

        const inner = document.createElement('div');
        inner.className = 'flashcard-inner';
        inner.style.position = 'relative';
        inner.style.width = '100%';
        inner.style.boxSizing = 'border-box';
        inner.style.borderRadius = '0.75rem';
        inner.style.backgroundColor = '#e5e7eb';
        inner.style.boxShadow = 'inset 0 0 0 1px rgba(226,232,240,0.9)';
        inner.style.padding = this._padding || '1.1rem 1.3rem';
        inner.style.minHeight = '140px';
        // Layout: row = side-by-side, column = stacked, flip = toggle visibility
        if (this._layout === 'row') {
            inner.style.display = 'flex';
            inner.style.flexDirection = 'row';
            inner.style.gap = '1rem';
            inner.style.alignItems = 'stretch';
        } else if (this._layout === 'column') {
            inner.style.display = 'flex';
            inner.style.flexDirection = 'column';
            inner.style.gap = '0.75rem';
        }

        const front = document.createElement('div');
        front.className = 'flashcard-face flashcard-front';
        front.style.textAlign = 'center';
        front.style.color = '#111827';
        front.style.display = 'flex';
        front.style.alignItems = 'center';
        front.style.justifyContent = 'center';
        if (this._layout === 'row') front.style.flex = '1';

        const back = document.createElement('div');
        back.className = 'flashcard-face flashcard-back';
        back.style.textAlign = 'center';
        back.style.color = '#111827';
        back.style.display = 'flex';
        back.style.alignItems = 'center';
        back.style.justifyContent = 'center';
        back.style.visibility = 'hidden';
        if (this._layout === 'row') back.style.flex = '1';
        // For flip layout, back absolutely overlaps front (takes same space)
        if (this._layout === 'flip') {
            back.style.position = 'absolute';
            back.style.top = '0';
            back.style.left = '0';
            back.style.right = '0';
            back.style.bottom = '0';
            back.style.padding = this._padding || '1.1rem 1.3rem';
            back.style.boxSizing = 'border-box';
        }

        inner.appendChild(front);
        inner.appendChild(back);

        const controls = document.createElement('div');
        controls.className = 'flashcard-controls';
        controls.style.display = 'flex';
        controls.style.flexDirection = 'column';
        controls.style.alignItems = 'center';
        controls.style.gap = '4px';
        controls.style.marginTop = '0.75em';
        controls.style.minHeight = '70px';
        controls.style.justifyContent = 'flex-start';

        const footer = document.createElement('div');
        footer.className = 'flashcard-footer';
        footer.style.display = 'flex';
        footer.style.flexDirection = 'column';
        footer.style.alignItems = 'center';
        footer.style.justifyContent = 'center';
        footer.style.marginTop = '0.5em';
        footer.style.fontSize = '0.8rem';
        footer.style.color = '#111827';

        const score = document.createElement('div');
        score.className = 'flashcard-score';
        score.style.textAlign = 'center';

        const summary = document.createElement('div');
        summary.className = 'flashcard-summary';
        summary.style.textAlign = 'center';

        // SR header area (login status, inserted dynamically)
        const srHeader = document.createElement('div');
        srHeader.className = 'flashcard-sr-header';
        container.appendChild(srHeader);

        container.appendChild(inner);
        container.appendChild(controls);
        footer.appendChild(score);
        footer.appendChild(summary);
        container.appendChild(footer);

        const reportContainer = document.createElement('div');
        reportContainer.className = 'flashcard-report-container';
        reportContainer.style.display = 'none';
        reportContainer.style.marginTop = '0.5em';
        reportContainer.style.padding = '1rem';
        reportContainer.style.borderRadius = '0.75rem';
        reportContainer.style.background = 'linear-gradient(145deg,#e5e7eb,#d1d5db)';
        reportContainer.style.border = '1px solid rgba(148,163,184,0.5)';
        reportContainer.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
        container.appendChild(reportContainer);

        this.appendChild(container);

        this._container = container;
        this._cardInner = inner;
        this._frontEl = front;
        this._backEl = back;
        this._controlsEl = controls;
        this._scoreEl = score;
        this._summaryEl = summary;
        this._reportContainer = reportContainer;
        this._footer = footer;
        this._srHeaderEl = srHeader;
    }

    _currentCard() {
        return this._cards[this._currentIndex] || { front: '', back: '' };
    }

    _showingIntro() {
        return !!this._intro && !this._introShown && this._round === 1 && this._currentIndex === 0 && this._roundStartTime == null;
    }

    _splitSpeak(text, side) {
        const raw = String(text || '');
        const sideSpeak = side === 'front' ? this._speakFront : this._speakBack;
        const cardSpeakAllowed = side === 'front' ? this._speakFrontCard : this._speakBackCard;
        const speakEnabled = this._speak || sideSpeak || cardSpeakAllowed;
        if (!speakEnabled) {
            // No speaking: show text as-is, treat #/## literally.
            return { display: raw, speak: '' };
        }
        if (raw.includes('##')) {
            const idx = raw.indexOf('##');
            const before = raw.slice(0, idx);
            const after = raw.slice(idx + 2);
            // Speak both parts, only show text before the marker.
            return { display: before, speak: (before + ' ' + after).trim() };
        }
        const idx = raw.indexOf('#');
        if (idx === -1) {
            // No markers: speak the whole text when speaking is enabled.
            return { display: raw, speak: raw.trim() };
        }
        const before = raw.slice(0, idx);
        const after = raw.slice(idx + 1);
        // Single #: show only text before, speak only the comment after.
        if (after.trim()) {
            return { display: before, speak: after.trim() };
        }
        // Fallback: no meaningful comment, speak the visible part.
        return { display: before, speak: before.trim() };
    }

    _isImageLike(text) {
        const s = String(text || '').trim();
        if (!s) return false;
        const hashIdx = s.indexOf('#');
        const urlPart = hashIdx === -1 ? s : s.slice(0, hashIdx);
        if (/^https?:\/\//i.test(urlPart)) return true;
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(urlPart)) return true;
        return false;
    }

    _renderSide(side, text, targetEl) {
        targetEl.innerHTML = '';
        const raw = String(text || '');
        const { display, speak } = this._splitSpeak(raw, side);
        const trimmed = display.trim();

        if (this._isImageLike(raw)) {
            const s = raw.trim();
            const hashIdx = s.indexOf('#');
            const urlPart = hashIdx === -1 ? s : s.slice(0, hashIdx);
            const img = document.createElement('img');
            img.src = urlPart;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.margin = this._center ? '0 auto' : '0';
            if (speak) img.alt = speak;
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.appendChild(img);
            if (this._pointMode && side === 'front') {
                wrapper.style.cursor = 'crosshair';
                wrapper.addEventListener('click', this._onImageClick);
                this._imageWrapperFront = wrapper;
            }
            if (this._answerRegion && side === 'back') {
                this._imageWrapperBack = wrapper;
                this._renderAnswerRegionOverlay(wrapper, img);
            }
            targetEl.appendChild(wrapper);
        } else if (trimmed) {
            const md = document.createElement('ui-markdown');
            md.setAttribute('math', 'true');
            md.content = trimmed;
            md.style.maxWidth = '100%';
            md.style.display = 'block';
            md.style.textAlign = 'center';
            md.style.width = '100%';
            targetEl.appendChild(md);
        } else {
            const placeholder = document.createElement('div');
            placeholder.textContent = '';
            targetEl.appendChild(placeholder);
        }

        // Front speech is handled in _scheduleRevealBack (waits for it before revealing).
        // Back speech is triggered when we flip to back (in _scheduleRevealBack or _recordAnswer).
    }

    _renderAnswerRegionOverlay(wrapper, img) {
        if (!this._answerRegion) return;
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.border = '2px solid rgba(34,197,94,.9)';
        overlay.style.background = 'rgba(34,197,94,.2)';
        overlay.style.pointerEvents = 'none';
        const update = () => {
            const rect = img.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            overlay.style.left = this._answerRegion.x1 * rect.width + 'px';
            overlay.style.top = this._answerRegion.y1 * rect.height + 'px';
            overlay.style.width = Math.max(0, (this._answerRegion.x2 - this._answerRegion.x1) * rect.width) + 'px';
            overlay.style.height = Math.max(0, (this._answerRegion.y2 - this._answerRegion.y1) * rect.height) + 'px';
        };
        window.requestAnimationFrame(update);
        wrapper.appendChild(overlay);
    }

    // --- Spaced repetition methods ---

    _initSR() {
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr) { this._srEnabled = false; return; }
        const user = sr.getUser();
        if (!user) { this._srEnabled = false; return; }
        this._srEnabled = true;
        if (this._originalCards.length) {
            this._srDeckId = sr.deckId(this._originalCards);
            this._srDeckData = sr.getDeckData(user, this._srDeckId);
        }
    }

    _promptLogin(onDone) {
        // Show inline login prompt in the report container area
        if (!this._reportContainer) return;
        if (this._cardInner) this._cardInner.style.display = 'none';
        if (this._controlsEl) this._controlsEl.style.display = 'none';
        if (this._footer) this._footer.style.display = 'none';
        this._reportContainer.style.display = 'block';
        this._reportContainer.innerHTML = '';

        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.fontSize = '1rem';
        title.style.marginBottom = '0.5rem';
        title.style.color = '#000';
        title.textContent = 'Log in for smart learning';
        this._reportContainer.appendChild(title);

        const desc = document.createElement('div');
        desc.style.fontSize = '0.85rem';
        desc.style.marginBottom = '0.75rem';
        desc.style.color = '#374151';
        desc.textContent = 'Enter a name to track your progress across sessions.';
        this._reportContainer.appendChild(desc);

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '0.5rem';
        row.style.alignItems = 'center';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Your name';
        input.style.padding = '0.35rem 0.6rem';
        input.style.borderRadius = '0.4rem';
        input.style.border = '1px solid #cbd5e1';
        input.style.fontSize = '0.9rem';
        input.style.flex = '1';
        input.style.color = '#000';
        input.style.background = '#fff';

        const goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.className = 'choice-btn';
        goBtn.textContent = 'Go';
        goBtn.style.padding = '0.35rem 0.8rem';
        goBtn.style.borderRadius = '0.4rem';
        goBtn.style.border = '1px solid rgba(34,197,94,0.6)';
        goBtn.style.background = '#ecfdf3';
        goBtn.style.color = '#15803d';
        goBtn.style.cursor = 'pointer';

        const submit = () => {
            const name = input.value.trim();
            if (!name) return;
            const sr = window.Xplainer && window.Xplainer.sr;
            if (sr) sr.setUser(name);
            this._initSR();
            this._reportContainer.style.display = 'none';
            if (onDone) onDone();
        };

        goBtn.onclick = submit;
        // Stop all key events from reaching the player's keyboard shortcuts
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submit();
        });
        input.addEventListener('keyup', (e) => e.stopPropagation());
        input.addEventListener('keypress', (e) => e.stopPropagation());

        row.appendChild(input);
        row.appendChild(goBtn);
        this._reportContainer.appendChild(row);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'choice-btn';
        cancelBtn.textContent = 'Skip';
        cancelBtn.style.marginTop = '0.5rem';
        cancelBtn.style.fontSize = '0.8rem';
        cancelBtn.style.color = '#6b7280';
        cancelBtn.style.border = 'none';
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.onclick = () => {
            this._reportContainer.style.display = 'none';
            if (this._cardInner) this._cardInner.style.display = '';
            if (this._controlsEl) this._controlsEl.style.display = '';
            if (this._footer) this._footer.style.display = '';
        };
        this._reportContainer.appendChild(cancelBtn);

        setTimeout(() => input.focus(), 50);
    }

    _applySROrder() {
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr || !this._srDeckData) return;
        this._cards = sr.sortByPriority(this._cards, this._srDeckData);
        this._smartOrder = true;
    }

    _recordAnswerSR(card, rating) {
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr || !this._srEnabled || !this._srDeckId) return;
        const user = sr.getUser();
        if (!user) return;
        const cid = sr.cardId(card.front);
        const prev = sr.getCardData(this._srDeckData, cid);
        const updated = sr.recordAnswer(prev, rating);
        this._srDeckData[cid] = updated;
        sr.saveDeckData(user, this._srDeckId, this._srDeckData);
        if (rating >= 1) this._srSession.add(cid); // partial or correct
    }

    _startDrillMode() {
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr) return;
        this._drillMode = true;
        this._srSession = new Set();
        // Restore full deck and sort by SR priority
        this._cards = this._originalCards.map((c) => ({ ...c }));
        this._cards = sr.sortByPriority(this._cards, this._srDeckData);
        this._currentIndex = 0;
        this._round += 1;
        this._roundStartTime = null;
        this._roundComplete = false;
        this._cardShownAt = null;
        this._renderCurrentCard();
    }

    _drillInsertRetry(card) {
        // In drill mode, insert wrong card ~3-5 positions later (spaced repetition within session)
        const remaining = this._cards.length - this._currentIndex - 1;
        const gap = Math.min(3 + Math.floor(Math.random() * 3), remaining);
        const insertAt = this._currentIndex + 1 + gap;
        const copy = { front: card.front, back: card.back, id: 'drill-' + (card.id ?? '') + '-' + Date.now() };
        this._cards.splice(insertAt, 0, copy);
    }

    _checkDrillComplete() {
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr) return false;
        return sr.isDeckMastered(this._originalCards, this._srDeckData, this._srSession);
    }

    _showDrillProgress() {
        if (!this._drillMode || !this._summaryEl) return;
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr) return;
        const stats = sr.deckStats(this._originalCards, this._srDeckData);
        this._summaryEl.textContent = `Mastered: ${stats.mastered}/${stats.total} cards`;
    }

    _showDrillComplete() {
        if (!this._reportContainer || !this._cardInner || !this._controlsEl) return;
        this._cardInner.style.display = 'none';
        this._controlsEl.style.display = 'none';
        if (this._footer) this._footer.style.display = 'none';
        this._reportContainer.style.display = 'block';
        this._reportContainer.innerHTML = '';

        const sr = window.Xplainer && window.Xplainer.sr;
        const stats = sr ? sr.deckStats(this._originalCards, this._srDeckData) : null;

        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.fontSize = '1.1rem';
        title.style.marginBottom = '0.5rem';
        title.style.color = '#15803d';
        title.textContent = 'Well done!';
        this._reportContainer.appendChild(title);

        const msg = document.createElement('div');
        msg.style.marginBottom = '0.5rem';
        msg.style.color = '#000';
        msg.textContent = stats
            ? `All ${stats.total} cards mastered (box ${sr.MASTERY_BOX}+).`
            : 'All cards mastered.';
        this._reportContainer.appendChild(msg);

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '0.5rem';
        btnRow.style.marginTop = '0.75rem';
        btnRow.style.flexWrap = 'wrap';
        btnRow.style.justifyContent = 'center';

        const continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.className = 'choice-btn';
        continueBtn.style.color = '#000';
        continueBtn.textContent = 'Continue';
        continueBtn.onclick = () => {
            this._drillMode = false;
            // Dispatch click event so the player can advance past the flashcard
            this.dispatchEvent(new Event('click', { bubbles: true }));
        };
        btnRow.appendChild(continueBtn);

        const drillAgainBtn = document.createElement('button');
        drillAgainBtn.type = 'button';
        drillAgainBtn.className = 'choice-btn';
        drillAgainBtn.style.color = '#000';
        drillAgainBtn.textContent = 'Drill again';
        drillAgainBtn.onclick = () => this._startDrillMode();
        btnRow.appendChild(drillAgainBtn);

        this._reportContainer.appendChild(btnRow);
    }

    _renderMasteryDot(card) {
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr || !this._srEnabled) return null;
        const cid = sr.cardId(card.front);
        const cd = sr.getCardData(this._srDeckData, cid);
        const dot = document.createElement('span');
        dot.style.display = 'inline-block';
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = sr.boxColor(cd.box);
        dot.title = sr.boxLabel(cd.box) + ' (box ' + cd.box + ')';
        return dot;
    }

    _renderSRUserHeader() {
        // Small login status shown at top of card container
        const sr = window.Xplainer && window.Xplainer.sr;
        if (!sr) return null;
        const user = sr.getUser();
        if (!user) return null;
        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.justifyContent = 'flex-end';
        el.style.alignItems = 'center';
        el.style.fontSize = '0.7rem';
        el.style.color = '#6b7280';
        el.style.marginBottom = '0.25rem';
        el.style.gap = '0.3rem';
        const label = document.createElement('span');
        label.textContent = user;
        const logoutBtn = document.createElement('span');
        logoutBtn.textContent = '\u00D7';
        logoutBtn.style.cursor = 'pointer';
        logoutBtn.style.fontSize = '0.85rem';
        logoutBtn.style.color = '#9ca3af';
        logoutBtn.title = 'Log out';
        logoutBtn.onclick = (e) => {
            e.stopPropagation();
            sr.clearUser();
            this._srEnabled = false;
            this._smartOrder = false;
            this._drillMode = false;
            // Restore original order
            this._cards = this._originalCards.map((c) => ({ ...c }));
            this._currentIndex = 0;
            this._round = 1;
            this._results = [];
            this._roundStartTime = null;
            this._roundComplete = false;
            this._renderCurrentCard();
        };
        el.appendChild(label);
        el.appendChild(logoutBtn);
        return el;
    }

    // --- Mode preference (drill vs ask_all) ---

    _getFlashcardModePref() {
        try {
            const val = localStorage.getItem('xplainer_flashcard_mode');
            return val === 'drill' ? 'drill' : 'ask_all';
        } catch (_) { return 'ask_all'; }
    }

    _setFlashcardModePref(mode) {
        try {
            localStorage.setItem('xplainer_flashcard_mode', mode === 'drill' ? 'drill' : 'ask_all');
        } catch (_) {}
    }

    // --- Card text helpers (reverse support) ---

    _getQuestion(card) {
        return this._reversed ? (card.back || '') : (card.front || '');
    }

    _getAnswer(card) {
        return this._reversed ? (card.front || '') : (card.back || '');
    }

    _getQuestionLang() {
        return this._reversed ? this._langBack : this._langFront;
    }

    _getAnswerLang() {
        return this._reversed ? this._langFront : this._langBack;
    }

    _toggleReverse() {
        this._reversed = !this._reversed;
        this._currentIndex = 0;
        this._results = [];
        this._round = 1;
        this._roundStartTime = null;
        this._roundComplete = false;
        this._cardShownAt = null;
        this._answerRevealed = false;
        this._introShown = !!this._intro ? false : true;
        this._renderCurrentCard();
    }

    _revealAnswer() {
        if (this._answerRevealed) return;
        this._answerRevealed = true;
        if (this._layout === 'flip') {
            // Flip mode: hide front, show back (both layered in same space)
            if (this._frontEl) this._frontEl.style.visibility = 'hidden';
            if (this._backEl) this._backEl.style.visibility = 'visible';
        } else {
            // Row/column: make answer side visible (layout already accounts for it)
            if (this._backEl) this._backEl.style.visibility = 'visible';
        }
        // Speak the answer
        const card = this._currentCard();
        const aText = this._getAnswer(card);
        const aLang = this._getAnswerLang();
        const { speak: backSpeak } = this._splitSpeak(aText, 'back');
        if (backSpeak) this._speakText(backSpeak, aLang);
        // Re-render controls to show rating buttons
        this._renderControls(false);
        // Focus partial button (default action) for keyboard/tab access
        setTimeout(() => {
            if (!this._controlsEl) return;
            const buttons = this._controlsEl.querySelectorAll('button');
            // Find the Partial button (middle of Wrong/Partial/Correct)
            for (const btn of buttons) {
                if (btn.textContent === 'Partial') {
                    btn.focus();
                    break;
                }
            }
        }, 0);
    }

    // --- End spaced repetition methods ---

    _renderCurrentCard() {
        if (!this._frontEl || !this._backEl) return;
        if (!this._cards.length && !this._intro) return;
        if (this._currentIndex < 0) this._currentIndex = 0;
        if (this._currentIndex >= this._cards.length) this._currentIndex = this._cards.length - 1;

        this._flipped = false;
        this._answerRevealed = false;
        this._frontEl.style.visibility = 'visible';
        this._backEl.style.visibility = 'hidden';
        this._imageWrapperFront = null;
        this._imageWrapperBack = null;

        if (this._showingIntro()) {
            this._renderSide('front', this._intro, this._frontEl);
            this._backEl.innerHTML = '';
            this._renderControls(true);
            this._scoreEl.textContent = '';
            this._summaryEl.textContent = '';
            this._cardShownAt = null;
            this._roundStartTime = null;
            this._clearRevealAndAdvanceTimers();
            this._focusPrimaryControl();
            return;
        }

        if (this._reportContainer) this._reportContainer.style.display = 'none';
        if (this._cardInner) this._cardInner.style.display = '';
        if (this._controlsEl) this._controlsEl.style.display = '';
        if (this._footer) this._footer.style.display = '';

        const card = this._currentCard();
        const qText = this._getQuestion(card);
        const aText = this._getAnswer(card);
        this._hasAnsweredCurrentCard = false;
        this._clearRevealAndAdvanceTimers();
        this._renderSide('front', qText, this._frontEl);
        this._renderSide('back', aText, this._backEl);
        // Hide answer initially (visibility keeps layout stable)
        this._backEl.style.visibility = 'hidden';
        this._frontEl.style.visibility = 'visible';
        this._renderControls(false);
        this._updateScoreSummary();
        // Show drill progress in summary area during drill mode
        if (this._drillMode) this._showDrillProgress();
        // Update SR header (user login status)
        if (this._srHeaderEl) {
            this._srHeaderEl.innerHTML = '';
            const hdr = this._renderSRUserHeader();
            if (hdr) this._srHeaderEl.appendChild(hdr);
        }
        this._startRoundIfNeeded();
        this._cardShownAt = performance.now();
        // Speak question (non-blocking — user can reveal answer anytime)
        const qLang = this._getQuestionLang();
        const { speak: frontSpeak } = this._splitSpeak(qText, 'front');
        if ((this._speak || this._speakFront) && frontSpeak) {
            this._speakText(frontSpeak, qLang);
        }
        // Auto-reveal if timed mode
        if (typeof this._reveal === 'number' && this._reveal > 0) {
            this._autoRevealTimer = setTimeout(() => {
                this._autoRevealTimer = null;
                if (!this._answerRevealed && !this._hasAnsweredCurrentCard) {
                    this._revealAnswer();
                }
            }, this._reveal * 1000);
        }
        // Focus primary control so Enter can reveal the answer
        this._focusPrimaryControl();
    }

    _focusPrimaryControl() {
        setTimeout(() => {
            if (!this._controlsEl) return;
            const buttons = this._controlsEl.querySelectorAll('button');
            if (!buttons.length) return;
            // Prefer "Show answer" during phase 1, else "Start", else first button
            let target = null;
            for (const btn of buttons) {
                if (btn.textContent === 'Show answer') { target = btn; break; }
            }
            if (!target) {
                for (const btn of buttons) {
                    if (btn.textContent === 'Start') { target = btn; break; }
                }
            }
            if (!target) target = buttons[0];
            try { target.focus({ preventScroll: true }); }
            catch (_) { target.focus(); }
        }, 0);
    }

    _renderControls(showIntro) {
        if (!this._controlsEl) return;
        this._controlsEl.innerHTML = '';
        const cardCount = this._cards.length;

        const makeBtn = (label) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn xp-fc-btn';
            btn.textContent = label;
            btn.style.minWidth = '90px';
            btn.style.borderRadius = '999px';
            btn.style.border = '1px solid rgba(148,163,184,0.7)';
            btn.style.background = '#f9fafb';
            btn.style.color = '#374151';
            btn.style.fontSize = '0.85rem';
            btn.style.padding = '0.3rem 0.9rem';
            btn.style.textAlign = 'center';
            btn.style.display = 'inline-flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.cursor = 'pointer';
            return btn;
        };

        if (showIntro) {
            const introLabel = document.createElement('span');
            introLabel.textContent = `Flashcard deck (${cardCount} cards)`;
            introLabel.style.marginBottom = '0.4rem';
            introLabel.style.fontSize = '0.9rem';
            introLabel.style.color = '#111827';
            introLabel.style.textAlign = 'center';
            this._controlsEl.appendChild(introLabel);

            // Show deck progress if SR data exists
            const sr = window.Xplainer && window.Xplainer.sr;
            if (sr && this._srEnabled && this._srDeckData && Object.keys(this._srDeckData).length > 0) {
                const stats = sr.deckStats(this._originalCards, this._srDeckData);
                if (stats.studied) {
                    const progress = document.createElement('div');
                    progress.style.fontSize = '0.8rem';
                    progress.style.color = '#374151';
                    progress.style.marginBottom = '0.4rem';
                    progress.textContent = `Mastery: ${stats.percent}% (${stats.mastered}/${stats.total} cards)`;
                    this._controlsEl.appendChild(progress);
                }
            }

            // Determine current mode preference (drill or ask_all)
            const preferredMode = this._getFlashcardModePref();

            // Main row: [Start] [Options]
            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.gap = '0.5rem';
            btnRow.style.flexWrap = 'wrap';
            btnRow.style.justifyContent = 'center';
            btnRow.style.alignItems = 'center';

            const startBtn = makeBtn('Start');
            startBtn.style.minWidth = '110px';
            if (preferredMode === 'drill') {
                // Start uses drill mode
                startBtn.style.background = '#eff6ff';
                startBtn.style.borderColor = 'rgba(59,130,246,0.5)';
                startBtn.style.color = '#1d4ed8';
            }
            startBtn.onclick = () => {
                if (preferredMode === 'drill') {
                    if (!this._srEnabled) {
                        this._promptLogin(() => {
                            this._introShown = true;
                            this._startDrillMode();
                        });
                        return;
                    }
                    this._introShown = true;
                    this._startDrillMode();
                } else {
                    this._roundStartTime = null;
                    this._roundComplete = false;
                    this._introShown = true;
                    this._renderCurrentCard();
                }
            };
            btnRow.appendChild(startBtn);

            const optionsBtn = makeBtn('Options');
            optionsBtn.style.minWidth = '110px';
            optionsBtn.onclick = () => {
                this._showOptionsPanel = !this._showOptionsPanel;
                this._renderControls(true);
            };
            btnRow.appendChild(optionsBtn);

            this._controlsEl.appendChild(btnRow);

            // Options panel (shown when toggled)
            if (this._showOptionsPanel) {
                const optPanel = document.createElement('div');
                optPanel.style.display = 'flex';
                optPanel.style.flexDirection = 'column';
                optPanel.style.gap = '0.35rem';
                optPanel.style.marginTop = '0.5rem';
                optPanel.style.alignItems = 'center';

                const reverseBtn = makeBtn(this._reversed ? 'Normal order' : 'Reverse Q/A');
                reverseBtn.style.fontSize = '0.75rem';
                reverseBtn.style.padding = '0.2rem 0.8rem';
                reverseBtn.onclick = () => this._toggleReverse();
                optPanel.appendChild(reverseBtn);

                if (sr) {
                    const drillBtn = makeBtn('Drill to mastery');
                    drillBtn.style.fontSize = '0.75rem';
                    drillBtn.style.padding = '0.2rem 0.8rem';
                    drillBtn.style.background = '#eff6ff';
                    drillBtn.style.borderColor = 'rgba(59,130,246,0.5)';
                    drillBtn.style.color = '#1d4ed8';
                    drillBtn.onclick = () => {
                        this._setFlashcardModePref('drill');
                        if (!this._srEnabled) {
                            this._promptLogin(() => {
                                this._introShown = true;
                                this._startDrillMode();
                            });
                            return;
                        }
                        this._introShown = true;
                        this._startDrillMode();
                    };
                    optPanel.appendChild(drillBtn);
                }

                const askAllBtn = makeBtn('Ask all once');
                askAllBtn.style.fontSize = '0.75rem';
                askAllBtn.style.padding = '0.2rem 0.8rem';
                askAllBtn.onclick = () => {
                    this._setFlashcardModePref('ask_all');
                    this._roundStartTime = null;
                    this._roundComplete = false;
                    this._introShown = true;
                    this._renderCurrentCard();
                };
                optPanel.appendChild(askAllBtn);

                this._controlsEl.appendChild(optPanel);
            }
            return;
        }

        // --- During study: two-phase controls ---
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.flexWrap = 'wrap';
        row.style.justifyContent = 'center';
        row.style.alignItems = 'center';
        row.style.gap = '0.6rem';

        if (!this._answerRevealed) {
            // Phase 1: "Show answer" button
            const showBtn = makeBtn('Show answer');
            showBtn.style.background = '#f0f9ff';
            showBtn.style.borderColor = 'rgba(59,130,246,0.6)';
            showBtn.style.color = '#1d4ed8';
            showBtn.style.minWidth = '130px';
            showBtn.style.setProperty('--xp-fc-focus-color', 'rgba(59,130,246,0.45)');
            showBtn.onclick = () => this._revealAnswer();
            row.appendChild(showBtn);
        } else if (this._record && this._mode !== 'auto') {
            // Phase 2: Wrong | Partial | Correct (Partial is default)
            const wrongBtn = makeBtn('Wrong');
            wrongBtn.style.background = '#fef2f2';
            wrongBtn.style.borderColor = 'rgba(239,68,68,0.7)';
            wrongBtn.style.color = '#b91c1c';
            wrongBtn.style.setProperty('--xp-fc-focus-color', 'rgba(239,68,68,0.5)');
            wrongBtn.onclick = () => this._recordAnswer(0);
            row.appendChild(wrongBtn);

            const partialBtn = makeBtn('Partial');
            partialBtn.style.background = '#fefce8';
            partialBtn.style.borderColor = 'rgba(234,179,8,0.8)';
            partialBtn.style.color = '#a16207';
            partialBtn.style.fontWeight = 'bold';
            partialBtn.style.setProperty('--xp-fc-focus-color', 'rgba(234,179,8,0.55)');
            partialBtn.classList.add('xp-fc-default'); // permanent soft ring to mark as default
            partialBtn.onclick = () => this._recordAnswer(1);
            row.appendChild(partialBtn);

            const correctBtn = makeBtn('Correct');
            correctBtn.style.background = '#ecfdf3';
            correctBtn.style.borderColor = 'rgba(34,197,94,0.7)';
            correctBtn.style.color = '#15803d';
            correctBtn.style.setProperty('--xp-fc-focus-color', 'rgba(34,197,94,0.5)');
            correctBtn.onclick = () => this._recordAnswer(2);
            row.appendChild(correctBtn);
        }

        this._controlsEl.appendChild(row);

        const infoRow = document.createElement('div');
        infoRow.style.display = 'flex';
        infoRow.style.justifyContent = 'center';
        infoRow.style.alignItems = 'center';
        infoRow.style.gap = '0.4rem';
        infoRow.style.marginTop = '0.35rem';
        infoRow.style.fontSize = '0.75rem';
        infoRow.style.color = '#111827';

        // Mastery dot (shows box level for current card)
        const card = this._currentCard();
        const dot = this._renderMasteryDot(card);
        if (dot) infoRow.appendChild(dot);

        const idxDisplay = document.createElement('span');
        idxDisplay.textContent = `Card ${this._currentIndex + 1} of ${cardCount} (round ${this._round})`;

        infoRow.appendChild(idxDisplay);

        this._controlsEl.appendChild(infoRow);

        // Stop drilling button (visible during drill mode)
        if (this._drillMode) {
            const stopBtn = makeBtn('Stop drilling');
            stopBtn.style.fontSize = '0.75rem';
            stopBtn.style.padding = '0.2rem 0.6rem';
            stopBtn.style.color = '#6b7280';
            stopBtn.onclick = () => {
                this._drillMode = false;
                this._roundComplete = true;
                this._showReport();
            };
            this._controlsEl.appendChild(stopBtn);
        }

        if (this._roundComplete && this._retake) {
            const retakeWrongBtn = makeBtn('Retake wrong');
            retakeWrongBtn.onclick = () => this._retakeWrong();
            this._controlsEl.appendChild(retakeWrongBtn);

            const retakeAllBtn = makeBtn('Retake all');
            retakeAllBtn.onclick = () => this._retakeAll();
            this._controlsEl.appendChild(retakeAllBtn);
        }
    }

    _updateScoreSummary() {
        if (!this._scoreEl || !this._summaryEl) return;
        const totalCards = this._cards.length || 0;
        const answered = this._results.filter((r) => r.round === this._round);
        const correct = answered.filter((r) => r.correct).length;
        const pct = totalCards ? Math.round((correct / totalCards) * 100) : 0;

        if (this._roundComplete && totalCards) {
            this._scoreEl.textContent = `Round ${this._round}: ${correct}/${totalCards} correct (${pct}%).`;
            // Wall-clock time from round start
            const wallMs = this._roundStartTime ? performance.now() - this._roundStartTime : 0;
            const wallSec = (wallMs / 1000).toFixed(1);
            const wrongCount = answered.filter((r) => !r.correct).length;
            const partialCount = answered.filter((r) => r.rating === 1).length;
            const parts = [`Time: ${wallSec}s`];
            if (wrongCount) parts.push(`Wrong: ${wrongCount}`);
            if (partialCount) parts.push(`Partial: ${partialCount}`);
            this._summaryEl.textContent = parts.join('. ') + '.';
        } else {
            this._scoreEl.textContent = '';
            this._summaryEl.textContent = '';
        }
    }

    _showReport() {
        if (!this._reportContainer || !this._cardInner || !this._controlsEl) return;
        this._cardInner.style.display = 'none';
        this._controlsEl.style.display = 'none';
        if (this._footer) this._footer.style.display = 'none';
        this._reportContainer.style.display = 'block';
        this._reportContainer.style.color = '#000';
        this._reportContainer.style.textAlign = 'center';
        this._reportContainer.innerHTML = '';

        const totalCards = this._cards.length || 0;
        const answered = this._results.filter((r) => r.round === this._round);
        const correct = answered.filter((r) => r.correct).length;
        const pct = totalCards ? Math.round((correct / totalCards) * 100) : 0;
        const wrongCount = answered.filter((r) => r.rating === 0).length;
        const partialCount = answered.filter((r) => r.rating === 1).length;
        // Wall-clock time
        const wallMs = this._roundStartTime ? performance.now() - this._roundStartTime : 0;
        const totalSec = (wallMs / 1000).toFixed(1);

        // --- Header: centered title + stats ---
        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.fontSize = '1.05rem';
        title.style.marginBottom = '0.5rem';
        title.style.color = '#0f172a';
        title.style.textAlign = 'center';
        title.textContent = 'Round complete';
        this._reportContainer.appendChild(title);

        const scoreLine = document.createElement('div');
        scoreLine.style.marginBottom = '0.25rem';
        scoreLine.style.color = '#111827';
        scoreLine.style.textAlign = 'center';
        scoreLine.style.fontSize = '0.95rem';
        scoreLine.textContent = `Score: ${correct}/${totalCards} correct (${pct}%)`;
        this._reportContainer.appendChild(scoreLine);

        const summaryLine = document.createElement('div');
        summaryLine.style.marginBottom = '0.85rem';
        summaryLine.style.fontSize = '0.85rem';
        summaryLine.style.color = '#374151';
        summaryLine.style.textAlign = 'center';
        const parts = [`Time: ${totalSec}s`];
        if (wrongCount) parts.push(`Wrong: ${wrongCount}`);
        if (partialCount) parts.push(`Partial: ${partialCount}`);
        summaryLine.textContent = parts.join(' · ');
        this._reportContainer.appendChild(summaryLine);

        // --- Helper: uniform summary button ---
        const makeSumBtn = (label, accent) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn xp-fc-btn';
            btn.textContent = label;
            btn.style.minWidth = '110px';
            btn.style.borderRadius = '999px';
            btn.style.border = '1px solid rgba(148,163,184,0.7)';
            btn.style.background = '#f9fafb';
            btn.style.color = '#1f2937';
            btn.style.fontSize = '0.85rem';
            btn.style.padding = '0.35rem 0.9rem';
            btn.style.textAlign = 'center';
            btn.style.display = 'inline-flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.cursor = 'pointer';
            if (accent) btn.style.setProperty('--xp-fc-focus-color', accent);
            return btn;
        };

        // --- Row 1: retake actions (All | Repeat mistakes | Drill) ---
        if (this._retake) {
            const actionRow = document.createElement('div');
            actionRow.style.display = 'flex';
            actionRow.style.gap = '0.5rem';
            actionRow.style.marginTop = '0.25rem';
            actionRow.style.marginBottom = '0.5rem';
            actionRow.style.flexWrap = 'wrap';
            actionRow.style.justifyContent = 'center';

            const allBtn = makeSumBtn('Redo all', 'rgba(100,116,139,0.45)');
            allBtn.onclick = () => this._retakeAll();
            actionRow.appendChild(allBtn);

            const notCorrectCount = wrongCount + partialCount;
            if (notCorrectCount > 0) {
                const mistakesBtn = makeSumBtn('Redo mistakes', 'rgba(100,116,139,0.45)');
                mistakesBtn.onclick = () => this._retakeWrong();
                actionRow.appendChild(mistakesBtn);
            }

            const sr = window.Xplainer && window.Xplainer.sr;
            if (sr) {
                const drillBtn = makeSumBtn('Drill', 'rgba(100,116,139,0.45)');
                drillBtn.onclick = () => {
                    if (!this._srEnabled) {
                        this._promptLogin(() => this._startDrillMode());
                        return;
                    }
                    this._startDrillMode();
                };
                actionRow.appendChild(drillBtn);
            }

            this._reportContainer.appendChild(actionRow);
        }

        // --- Row 2: meta actions (Show mistakes | Reverse) ---
        const metaRow = document.createElement('div');
        metaRow.style.display = 'flex';
        metaRow.style.gap = '0.5rem';
        metaRow.style.marginBottom = '0.25rem';
        metaRow.style.flexWrap = 'wrap';
        metaRow.style.justifyContent = 'center';

        const wrongResults = this._results.filter(
            (r) => r.round === this._round && (r.rating != null ? r.rating < 2 : !r.correct)
        );
        let showMistakesBtn = null;
        let mistakesTableWrap = null;
        if (wrongResults.length > 0) {
            showMistakesBtn = makeSumBtn('Show mistakes', 'rgba(100,116,139,0.45)');
            showMistakesBtn.style.fontSize = '0.78rem';
            showMistakesBtn.style.minWidth = '100px';
            showMistakesBtn.style.padding = '0.25rem 0.7rem';

            mistakesTableWrap = document.createElement('div');
            mistakesTableWrap.style.display = 'none';
            mistakesTableWrap.style.marginTop = '0.5rem';
            mistakesTableWrap.style.overflow = 'auto';
            mistakesTableWrap.style.maxHeight = '200px';
            mistakesTableWrap.style.textAlign = 'left';
            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            table.style.fontSize = '0.82rem';
            table.style.color = '#000';
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th style="text-align:left;padding:6px 8px;border:1px solid #cbd5e1;color:#000;">Front</th><th style="text-align:left;padding:6px 8px;border:1px solid #cbd5e1;color:#000;">Back</th></tr>';
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            wrongResults.forEach((r) => {
                const row = document.createElement('tr');
                const frontCell = document.createElement('td');
                frontCell.style.padding = '6px 8px';
                frontCell.style.border = '1px solid #cbd5e1';
                frontCell.style.background = '#f8fafc';
                frontCell.style.color = '#000';
                frontCell.textContent = (r.front != null ? String(r.front) : '').replace(/#/g, ' ').trim() || '—';
                const backCell = document.createElement('td');
                backCell.style.padding = '6px 8px';
                backCell.style.border = '1px solid #cbd5e1';
                backCell.style.color = '#000';
                backCell.textContent = (r.back != null ? String(r.back) : '').replace(/#/g, ' ').trim() || '—';
                row.appendChild(frontCell);
                row.appendChild(backCell);
                tbody.appendChild(row);
            });
            table.appendChild(tbody);
            mistakesTableWrap.appendChild(table);

            showMistakesBtn.onclick = () => {
                const isHidden = mistakesTableWrap.style.display === 'none';
                mistakesTableWrap.style.display = isHidden ? 'block' : 'none';
                showMistakesBtn.textContent = isHidden ? 'Hide mistakes' : 'Show mistakes';
            };
            metaRow.appendChild(showMistakesBtn);
        }

        const reverseBtn = makeSumBtn(this._reversed ? 'Normal order' : 'Reverse', 'rgba(100,116,139,0.45)');
        reverseBtn.style.fontSize = '0.78rem';
        reverseBtn.style.minWidth = '100px';
        reverseBtn.style.padding = '0.25rem 0.7rem';
        reverseBtn.onclick = () => this._toggleReverse();
        metaRow.appendChild(reverseBtn);

        this._reportContainer.appendChild(metaRow);

        if (mistakesTableWrap) {
            this._reportContainer.appendChild(mistakesTableWrap);
        }

        // Deck progress (SR stats)
        const sr = window.Xplainer && window.Xplainer.sr;
        if (sr && this._srEnabled && this._srDeckData && Object.keys(this._srDeckData).length > 0) {
            const stats = sr.deckStats(this._originalCards, this._srDeckData);
            if (stats.studied) {
                const progressLine = document.createElement('div');
                progressLine.style.marginTop = '0.75rem';
                progressLine.style.fontSize = '0.78rem';
                progressLine.style.color = '#6b7280';
                progressLine.style.textAlign = 'center';
                progressLine.textContent = `Overall mastery: ${stats.percent}% (${stats.mastered}/${stats.total} cards at box ${sr.MASTERY_BOX}+)`;
                this._reportContainer.appendChild(progressLine);
            }
        }

        // Focus the "All" button so Enter triggers a retake immediately
        setTimeout(() => {
            if (!this._reportContainer) return;
            const btns = this._reportContainer.querySelectorAll('button');
            if (btns.length) {
                try { btns[0].focus({ preventScroll: true }); }
                catch (_) { btns[0].focus(); }
            }
        }, 0);
    }

    _startRoundIfNeeded() {
        if (this._showingIntro()) return;
        if (this._roundStartTime == null) {
            this._roundStartTime = performance.now();
        }
    }

    _finishRoundIfNeeded() {
        if (this._roundStartTime == null) return;
        const now = performance.now();
        const durationMs = now - this._roundStartTime;
        const answered = this._results.filter((r) => r.round === this._round);
        const totalCards = this._cards.length || 0;
        const correct = answered.filter((r) => r.correct).length;
        const pct = totalCards ? Math.round((correct / totalCards) * 100) : 0;
        this._roundComplete = true;
        this._updateScoreSummary();

        // Drill mode: check if mastered, otherwise start another round with unmastered cards
        if (this._drillMode) {
            if (this._checkDrillComplete()) {
                this._drillMode = false;
                this._showDrillComplete();
            } else {
                // Re-sort unmastered cards and continue drilling
                const sr = window.Xplainer && window.Xplainer.sr;
                if (sr) {
                    const unmastered = this._originalCards.filter((c) => {
                        const cid = sr.cardId(c.front);
                        const cd = sr.getCardData(this._srDeckData, cid);
                        return cd.box < sr.MASTERY_BOX || !this._srSession.has(cid);
                    });
                    if (unmastered.length === 0) {
                        this._drillMode = false;
                        this._showDrillComplete();
                    } else {
                        this._cards = sr.sortByPriority(
                            unmastered.map((c) => ({ ...c })),
                            this._srDeckData
                        );
                        this._currentIndex = 0;
                        this._round += 1;
                        this._roundStartTime = null;
                        this._roundComplete = false;
                        this._cardShownAt = null;
                        this._renderCurrentCard();
                    }
                } else {
                    this._showReport();
                }
                return;
            }
        } else {
            this._showReport();
        }

        if (window._ui_record_event) {
            window._ui_record_event({
                event: 'flashcard_round_complete',
                round: this._round,
                correct,
                total: totalCards,
                percent: pct,
                duration_ms: durationMs,
            });
        }
    }

    _toggleFlip() {
        if (!this._frontEl || !this._backEl) return;
        this._flipped = !this._flipped;
        this._frontEl.style.display = this._flipped ? 'none' : '';
        this._backEl.style.display = this._flipped ? '' : 'none';
        if (this._cardShownAt == null) this._cardShownAt = performance.now();
    }

    _insertRetryCard() {
        const card = this._currentCard();
        const copy = { front: card.front, back: card.back, id: card.id != null ? 'retry-' + card.id + '-' + Date.now() : Date.now() };
        this._cards.splice(this._currentIndex + 1, 0, copy);
    }

    _nextCard() {
        if (this._showingIntro()) {
            this._roundStartTime = null;
            this._renderCurrentCard();
            return;
        }
        if (this._currentIndex < this._cards.length - 1) {
            this._currentIndex += 1;
            this._renderCurrentCard();
        } else {
            this._finishRoundIfNeeded();
        }
    }

    _retakeWrong() {
        if (!this._retake) return;
        this._drillMode = false;
        // Include both wrong (rating=0) and partial (rating=1) answers
        const notCorrect = this._results.filter((r) => {
            if (r.round !== this._round) return false;
            // Use rating if available, fall back to !correct for legacy
            return r.rating != null ? r.rating < 2 : !r.correct;
        });
        if (!notCorrect.length) return;
        const ids = new Set(notCorrect.map((r) => r.card_id));
        // Filter from original cards to avoid losing cards from prior retake
        const source = this._originalCards.length ? this._originalCards : this._cards;
        this._cards = source.filter((c) => ids.has(c.id)).map((c) => ({ ...c }));
        this._currentIndex = 0;
        this._round += 1;
        this._roundStartTime = null;
        this._roundComplete = false;
        this._cardShownAt = null;
        this._renderCurrentCard();
    }

    _retakeAll() {
        if (!this._retake) return;
        this._drillMode = false;
        // Restore full deck from originals
        if (this._originalCards.length) {
            this._cards = this._originalCards.map((c) => ({ ...c }));
            if (this._srEnabled && this._smartOrder) {
                this._applySROrder();
            }
        }
        this._currentIndex = 0;
        this._round += 1;
        this._roundStartTime = null;
        this._roundComplete = false;
        this._cardShownAt = null;
        this._renderCurrentCard();
    }

    /** Record answer. rating: 0=wrong, 1=partial, 2=correct. Legacy boolean also accepted. */
    _recordAnswer(rating) {
        // Normalize: boolean true->2, false->0; number stays as-is
        if (rating === true) rating = 2;
        else if (rating === false) rating = 0;
        else rating = Math.max(0, Math.min(2, Math.round(Number(rating) || 0)));
        const correct = rating >= 2;

        this._hasAnsweredCurrentCard = true;
        this._clearRevealAndAdvanceTimers();
        const now = performance.now();
        if (this._cardShownAt == null) this._cardShownAt = now;
        const card = this._currentCard();
        const latency = now - this._cardShownAt;
        const existing = this._results.find(
            (r) => r.round === this._round && r.card_index === this._currentIndex
        );
        const base = {
            card_index: this._currentIndex,
            card_id: card.id,
            round: this._round,
            latency_ms: latency,
            correct,
            rating,
            front: card.front,
            back: card.back,
        };
        if (this._imageClickPos) {
            base.x = this._imageClickPos.x;
            base.y = this._imageClickPos.y;
            base.mode = 'point';
        }
        if (existing) {
            Object.assign(existing, base);
        } else {
            this._results.push(base);
        }
        if (window._ui_record_event) {
            window._ui_record_event({ event: 'flashcard_answer', ...base });
        }
        this._updateScoreSummary();

        // Record answer in SR system (persists to localStorage)
        if (this._srEnabled) {
            this._recordAnswerSR(card, rating);
        }

        // Insert retry for wrong answers
        if (rating === 0) {
            if (this._drillMode) {
                this._drillInsertRetry(card);
            } else if (this._immediateRetry) {
                this._insertRetryCard();
            }
        }
        this._nextCard();
    }

    _scheduleAutoplay() {
        if (this._autoTimer) {
            clearTimeout(this._autoTimer);
            this._autoTimer = null;
        }
        if (!this._cards.length) return;
        const delay = this._flipped ? this._backDuration : this._frontDuration;
        this._autoTimer = setTimeout(() => {
            this._autoTimer = null;
            if (!this.isConnected) return;
            if (!this._flipped) {
                this._toggleFlip();
                this._scheduleAutoplay();
            } else if (this._currentIndex < this._cards.length - 1) {
                this._currentIndex += 1;
                this._renderCurrentCard();
                this._scheduleAutoplay();
            } else {
                this._finishRoundIfNeeded();
            }
        }, delay);
    }

    _onCardClick() {
        if (!this._answerRevealed) {
            this._revealAnswer();
        }
    }

    _onKeyDown(e) {
        // If a button inside the flashcard has focus, let its native click handler
        // handle Enter/Space rather than firing our shortcut (prevents double-fire).
        const target = e.target;
        const targetIsButton = target && target.tagName === 'BUTTON';

        // Tab trap: cycle focus among the three rating buttons when answer is revealed
        if (e.key === 'Tab' && this._answerRevealed && !this._hasAnsweredCurrentCard && this._controlsEl) {
            const ratingBtns = Array.from(this._controlsEl.querySelectorAll('button'))
                .filter((b) => {
                    const t = b.textContent;
                    return t === 'Wrong' || t === 'Partial' || t === 'Correct';
                });
            if (ratingBtns.length >= 2) {
                e.preventDefault();
                e.stopPropagation();
                const activeEl = document.activeElement;
                let idx = ratingBtns.indexOf(activeEl);
                if (idx === -1) {
                    // Not currently on a rating button: focus Partial (default)
                    const partialIdx = ratingBtns.findIndex((b) => b.textContent === 'Partial');
                    ratingBtns[partialIdx >= 0 ? partialIdx : 0].focus();
                    return;
                }
                const step = e.shiftKey ? -1 : 1;
                const next = (idx + step + ratingBtns.length) % ratingBtns.length;
                ratingBtns[next].focus();
                return;
            }
        }

        if (e.key === 'Enter') {
            if (targetIsButton) return; // let button click handle it
            e.preventDefault();
            e.stopPropagation();
            if (!this._answerRevealed) {
                this._revealAnswer();
            } else if (!this._hasAnsweredCurrentCard) {
                this._recordAnswer(1); // partial (default)
            }
            return;
        }
        if (e.key === ' ' || e.key === 'Spacebar') {
            if (targetIsButton) return;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (this._record && this._answerRevealed && !this._hasAnsweredCurrentCard) {
            if (e.key === '1') {
                e.preventDefault();
                e.stopPropagation();
                this._recordAnswer(0); // Wrong
                return;
            }
            if (e.key === '2') {
                e.preventDefault();
                e.stopPropagation();
                this._recordAnswer(1); // Partial
                return;
            }
            if (e.key === '3') {
                e.preventDefault();
                e.stopPropagation();
                this._recordAnswer(2); // Correct
                return;
            }
        }
    }

    _onImageClick(event) {
        const img = event.currentTarget.querySelector('img');
        if (!img) return;
        const rect = img.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        this._imageClickPos = { x, y };
        if (this._answerRegion) {
            const correct =
                x >= this._answerRegion.x1 &&
                x <= this._answerRegion.x2 &&
                y >= this._answerRegion.y1 &&
                y <= this._answerRegion.y2;
            this._recordAnswer(correct);
        }
    }

    _speakText(text, lang) {
        if (!window.speechSynthesis) return;
        const utter = new SpeechSynthesisUtterance(String(text));
        utter.lang = lang || 'en-GB';
        try {
            window.speechSynthesis.cancel();
        } catch (_) {}
        window.speechSynthesis.speak(utter);
    }

    _speakTextWithEnd(text, lang, onEnd) {
        if (!text || !String(text).trim()) {
            if (onEnd) onEnd();
            return;
        }
        if (!window.speechSynthesis) {
            if (onEnd) onEnd();
            return;
        }
        const utter = new SpeechSynthesisUtterance(String(text));
        utter.lang = lang || 'en-GB';
        utter.onend = () => { if (onEnd) onEnd(); };
        utter.onerror = () => { if (onEnd) onEnd(); };
        try {
            window.speechSynthesis.cancel();
        } catch (_) {}
        window.speechSynthesis.speak(utter);
    }

    _clearRevealAndAdvanceTimers() {
        if (this._autoRevealTimer) {
            clearTimeout(this._autoRevealTimer);
            this._autoRevealTimer = null;
        }
        if (this._pendingAdvanceTimer) {
            clearTimeout(this._pendingAdvanceTimer);
            this._pendingAdvanceTimer = null;
        }
    }

    _scheduleRevealBack() {
        this._clearRevealAndAdvanceTimers();
        const card = this._currentCard();
        const { speak: frontSpeak } = this._splitSpeak(card.front, 'front');
        const delayMs = Math.max(0, this._revealBackAfterSec * 1000);

        const doReveal = () => {
            this._autoRevealTimer = null;
            if (this._hasAnsweredCurrentCard || !this._frontEl || !this._backEl) return;
            this._toggleFlip();
            const backSpeak = this._splitSpeak(card.back, 'back').speak;
            if (backSpeak) this._speakText(backSpeak, this._langBack);
        };

        if ((this._speak || this._speakFront) && frontSpeak) {
            this._speakTextWithEnd(frontSpeak, this._langFront, () => {
                if (this._hasAnsweredCurrentCard) return;
                doReveal();
            });
        } else if (delayMs <= 0) {
            doReveal();
        } else {
            this._autoRevealTimer = setTimeout(doReveal, delayMs);
        }
    }
}

customElements.define('ui-flashcard', UIFlashcard);

// Helper function to create markdown elements (similar to the Python _ui_markdown function)
function createMarkdownElement(content = "**Hello, World!**", math = true, font = null, font_size = "16px") {
    const comp = document.createElement("ui-markdown");
    if (math) {
        content = content.replace("//", "\\");
    }
    comp.content = content;
    if (font) {
        comp.font = font;
    }
    comp.style.fontSize = font_size;
    comp.math = math;
    return comp;
}

// Make it available globally
if (typeof window !== 'undefined') {
    window.createMarkdownElement = createMarkdownElement;
}

// Helper function to create accordion with HTML content
function createAccordionElement(title = "Accordion Title", content = "", htmlContent = "", markdown = true, math = true, background = "") {
    const element = document.createElement("ui-accordion");
    element.title = title;
    element.content = content;
    element.htmlContent = htmlContent;
    element.markdown = markdown;
    element.math = math;
    if (background) {
        element.background = background;
    }
    return element;
}

// Make it available globally
if (typeof window !== 'undefined') {
    window.createAccordionElement = createAccordionElement;
}

// Helper function to create UI elements dynamically
function createElement(elementType, ...args) {
    const element = document.createElement(elementType);
    
    // Handle arguments
    if (args.length > 0) {
        if (typeof args[0] === 'object' && args[0] !== null) {
            // First argument is an object with properties
            Object.assign(element, args[0]);
        } else {
            // Positional arguments
            args.forEach((arg, index) => {
                if (typeof arg === 'string') {
                    if (index === 0) {
                        // First string argument is usually content
                        element.textContent = arg;
                    } else {
                        // Additional string arguments
                        element.setAttribute(`data-arg${index}`, arg);
                    }
                } else if (typeof arg === 'number') {
                    element.setAttribute(`data-arg${index}`, arg);
                }
            });
        }
    }
    
    return element;
}

// Make createElement globally available
window.createElement = createElement;

// Pivot Table Component
class UIPivotTable extends HTMLElement {
    static get observedAttributes() {
        return ['data', 'rows', 'cols', 'vals', 'aggregatorName', 'rendererName', 'showUI', 
                'language', 'rendererOptions', 'engine', 'rowOrder', 'colOrder', 
                'derivedAttributes', 'dataClass', 'filter', 'inclusions', 'exclusions', 
                'hiddenAttributes', 'hiddenFromAggregators', 'hiddenFromDragDrop', 
                'sorters', 'onRefresh', 'menuLimit', 'autoSortUnusedAttrs', 
                'unusedAttrsVertical', 'localeStrings'];
    }

    constructor() {
        super();
        this._data = null;
        this._rows = [];
        this._cols = [];
        this._vals = [];
        this._aggregatorName = 'Sum';
        this._rendererName = 'Table';
        this._showUI = true;
        this._language = 'pyodide';
        this._rendererOptions = {};
        this._engine = null;
        this._rowOrder = null;
        this._colOrder = null;
        this._derivedAttributes = null;
        this._dataClass = null;
        this._filter = null;
        this._inclusions = null;
        this._exclusions = null;
        this._hiddenAttributes = null;
        this._hiddenFromAggregators = null;
        this._hiddenFromDragDrop = null;
        this._sorters = null;
        this._onRefresh = null;
        this._menuLimit = null;
        this._autoSortUnusedAttrs = null;
        this._unusedAttrsVertical = null;
        this._localeStrings = null;
        
        this.rendered = false;
        this.dataLoaded = false;
        this.pivotTable = null;
    }

    // Getters and setters
    get data() { return this._data; }
    set data(value) { 
        this._data = value; 
        if (this.rendered) this.handleDataChange();
    }

    get rows() { return this._rows; }
    set rows(value) { 
        this._rows = Array.isArray(value) ? value : [value]; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get cols() { return this._cols; }
    set cols(value) { 
        this._cols = Array.isArray(value) ? value : [value]; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get vals() { return this._vals; }
    set vals(value) { 
        this._vals = Array.isArray(value) ? value : [value]; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get aggregatorName() { return this._aggregatorName; }
    set aggregatorName(value) { 
        this._aggregatorName = value; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get rendererName() { return this._rendererName; }
    set rendererName(value) { 
        this._rendererName = value; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get showUI() { return this._showUI; }
    set showUI(value) { 
        this._showUI = value === 'true' || value === true; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get language() { return this._language; }
    set language(value) { 
        this._language = value; 
        if (this.rendered) this.handleDataChange();
    }

    get rendererOptions() { return this._rendererOptions; }
    set rendererOptions(value) { 
        this._rendererOptions = typeof value === 'string' ? JSON.parse(value) : value; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    get engine() { return this._engine; }
    set engine(value) { 
        this._engine = value; 
        if (this.rendered && this.dataLoaded) this.renderPivotTable();
    }

    // Additional getters for other attributes
    get rowOrder() { return this._rowOrder; }
    set rowOrder(value) { this._rowOrder = typeof value === 'string' ? JSON.parse(value) : value; }

    get colOrder() { return this._colOrder; }
    set colOrder(value) { this._colOrder = typeof value === 'string' ? JSON.parse(value) : value; }

    get derivedAttributes() { return this._derivedAttributes; }
    set derivedAttributes(value) { this._derivedAttributes = typeof value === 'string' ? JSON.parse(value) : value; }

    get dataClass() { return this._dataClass; }
    set dataClass(value) { this._dataClass = value; }

    get filter() { return this._filter; }
    set filter(value) { this._filter = typeof value === 'string' ? JSON.parse(value) : value; }

    get inclusions() { return this._inclusions; }
    set inclusions(value) { this._inclusions = typeof value === 'string' ? JSON.parse(value) : value; }

    get exclusions() { return this._exclusions; }
    set exclusions(value) { this._exclusions = typeof value === 'string' ? JSON.parse(value) : value; }

    get hiddenAttributes() { return this._hiddenAttributes; }
    set hiddenAttributes(value) { this._hiddenAttributes = typeof value === 'string' ? JSON.parse(value) : value; }

    get hiddenFromAggregators() { return this._hiddenFromAggregators; }
    set hiddenFromAggregators(value) { this._hiddenFromAggregators = typeof value === 'string' ? JSON.parse(value) : value; }

    get hiddenFromDragDrop() { return this._hiddenFromDragDrop; }
    set hiddenFromDragDrop(value) { this._hiddenFromDragDrop = typeof value === 'string' ? JSON.parse(value) : value; }

    get sorters() { return this._sorters; }
    set sorters(value) { this._sorters = typeof value === 'string' ? JSON.parse(value) : value; }

    get onRefresh() { return this._onRefresh; }
    set onRefresh(value) { this._onRefresh = value; }

    get menuLimit() { return this._menuLimit; }
    set menuLimit(value) { this._menuLimit = parseInt(value) || null; }

    get autoSortUnusedAttrs() { return this._autoSortUnusedAttrs; }
    set autoSortUnusedAttrs(value) { this._autoSortUnusedAttrs = value === 'true' || value === true; }

    get unusedAttrsVertical() { return this._unusedAttrsVertical; }
    set unusedAttrsVertical(value) { this._unusedAttrsVertical = value === 'true' || value === true; }

    get localeStrings() { return this._localeStrings; }
    set localeStrings(value) { this._localeStrings = typeof value === 'string' ? JSON.parse(value) : value; }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        this.render();
        this.rendered = true;
    }

    render() {
        this.innerHTML = '';
        
        // Create main container
        const container = document.createElement('div');
        container.classList.add('card-default');
        container.style.padding = '20px';
        
        // Create loading state
        this.loadingElement = document.createElement('div');
        this.loadingElement.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 18px; margin-bottom: 20px;">Loading Pivot Table...</div>
                <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            </div>
        `;
        
        // Add CSS for spinner
        if (!document.querySelector('#pivot-table-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'pivot-table-spinner-style';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
        
        container.appendChild(this.loadingElement);
        this.appendChild(container);
        
        // Handle data loading
        this.handleDataChange();
    }

    async handleDataChange() {
        if (!this._data) return;
        
        try {
            this.showLoading();
            
            // Determine if data is a string (dataframe name) or actual data
            if (typeof this._data === 'string') {
                if (this.isLikelyDataString(this._data)) {
                    // This looks like actual data, not a dataframe name
                    try {
                        // Check if it's a URL
                        if (this._data.trim().startsWith('http://') || this._data.trim().startsWith('https://')) {
                            // Fetch data from URL
                            const response = await fetch(this._data);
                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }
                            const textData = await response.text();
                            
                            // Try to parse as CSV first (most common for URLs)
                            if (textData.includes(',')) {
                                this._data = this.csvToRecords(textData);
                            } else {
                                // Try to parse as JSON
                                try {
                                    this._data = JSON.parse(textData);
                                } catch (jsonError) {
                                    throw new Error('URL data is neither valid CSV nor JSON');
                                }
                            }
                        } else if (this._data.trim().startsWith('[') || this._data.trim().startsWith('{')) {
                            // Parse as JSON
                            this._data = JSON.parse(this._data);
                        } else if (this._data.includes(',')) {
                            // Parse as CSV
                            this._data = this.csvToRecords(this._data);
                        }
                    } catch (parseError) {
                        console.warn('Failed to parse data string, treating as dataframe name:', parseError);
                        // If parsing fails, treat as dataframe name
                        const fetchedData = await this.fetchDataFromRuntime(this._data, this._language);
                        this._data = fetchedData;
                    }
                } else {
                    // This looks like a dataframe name, fetch from runtime
                    const fetchedData = await this.fetchDataFromRuntime(this._data, this._language);
                    this._data = fetchedData;
                }
            }
            
            // Validate data format
            if (!this.validateData(this._data)) {
                throw new Error('Invalid data format. Expected array of objects.');
            }
            
            this.dataLoaded = true;
            this.renderPivotTable();
            
        } catch (error) {
            console.error('Error loading pivot table data:', error);
            this.showError(`Failed to load data: ${error.message}`);
        }
    }

    async fetchDataFromRuntime(dataName, language) {
        switch (language.toLowerCase()) {
            case 'pyodide':
                return await this.fetchPyodideData(dataName);
            case 'brython':
                return await this.fetchBrythonData(dataName);
            case 'webr':
            case 'r':
                return await this.fetchRData(dataName);
            case 'stata':
                return await this.fetchStataData(dataName);
            default:
                throw new Error(`Unsupported language: ${language}`);
        }
    }

    async fetchPyodideData(dataName) {
        // Try multiple approaches to access Pyodide
        let pyodide = null;
        
        // Approach 1: Check if runPython is available (assumed function)
        if (typeof runPython !== 'undefined') {
            pyodide = { runPython: runPython };
        }
        // Approach 2: Try to access main page's pyodideInstance
        else if (typeof window !== 'undefined' && window.pyodideInstance) {
            pyodide = window.pyodideInstance;
        }
        // Approach 3: Try to access global pyodide
        else if (typeof window !== 'undefined' && window.pyodide) {
            pyodide = window.pyodide;
        }
        
        if (!pyodide) {
            throw new Error('Pyodide runtime not available. Please ensure Pyodide is initialized or use a Pyodide cell.');
        }

        const pythonCode = `
import json
import pandas as pd

try:
    # Get the dataframe from the current namespace
    df = ${dataName}
    
    # Check if it's a pandas DataFrame
    if isinstance(df, pd.DataFrame):
        # Convert to records format (best for PivotTable.js)
        result = df.to_dict(orient='records')
        result
    else:
        # Try to convert to DataFrame first
        df = pd.DataFrame(df)
        result = df.to_dict(orient='records')
        result
        
except NameError:
    {"error": f"Dataframe '{${dataName}}' not found"}
except Exception as e:
    {"error": f"Error processing data: {str(e)}"}
`;

        console.log('Executing Python code:', pythonCode);
        console.log('Data name:', dataName);
        console.log('Available pyodide methods:', Object.keys(pyodide));

        try {
            let result;
            
            // Try to execute the Python code step by step
            console.log('Step 1: Checking if dataframe exists');
            const checkCode = `${dataName}`;
            const checkResult = pyodide.runPython ? pyodide.runPython(checkCode) : await pyodide.runPythonAsync(checkCode);
            console.log('Dataframe check result:', checkResult);
            
            // Step 2: Try to get the DataFrame and convert it step by step
            console.log('Step 2: Converting DataFrame to records format');
            const convertCode = `
import json
import pandas as pd
df = ${dataName}
json.dumps(df.to_dict(orient='records'))
`;
            
            if (pyodide.runPython) {
                console.log('Using runPython method');
                result = pyodide.runPython(convertCode);
            } else if (pyodide.runPythonAsync) {
                console.log('Using runPythonAsync method');
                result = await pyodide.runPythonAsync(convertCode);
            } else {
                throw new Error('No valid Python execution method found');
            }
            
            console.log('Python execution result:', result);
            console.log('Result type:', typeof result);
            console.log('Result value:', result);
            
            // If result is a string (JSON), parse it directly
            if (typeof result === 'string') {
                console.log('Result is a string, parsing as JSON');
                try {
                    const parsedResult = JSON.parse(result);
                    console.log('Successfully parsed JSON:', parsedResult);
                    return parsedResult;
                } catch (parseError) {
                    console.error('Failed to parse JSON:', parseError);
                    throw new Error('Failed to parse JSON result from Python');
                }
            }
            
            return this.parseResult(result);
        } catch (error) {
            console.error('Python execution error details:', error);
            throw new Error(`Python execution error: ${error.message}`);
        }
    }

    async fetchBrythonData(dataName) {
        // Check if Brython is available via web2.html's approach
        if (!window.brythonSharedModule) {
            throw new Error('Brython runtime not available. Please ensure Brython is initialized by running a Brython cell first.');
        }

        const pythonCode = `
import json
import pandas as pd

try:
    # Get the dataframe from the current namespace
    df = ${dataName}
    
    # Check if it's a pandas DataFrame
    if isinstance(df, pd.DataFrame):
        result = df.to_dict(orient='records')
        json.dumps(result)
    else:
        # Try to convert to DataFrame first
        df = pd.DataFrame(df)
        result = df.to_dict(orient='records')
        json.dumps(result)
        
except NameError:
    json.dumps({"error": f"Dataframe '{${dataName}}' not found"})
except Exception as e:
    json.dumps({"error": f"Error processing data: {str(e)}"})
`;

        try {
            console.log('Executing Brython code:', pythonCode);
            console.log('Using brythonSharedModule._execute_code');
            
            // Use web2.html's Brython execution method
            const result = window.brythonSharedModule._execute_code(pythonCode);
            
            console.log('Brython execution result:', result);
            console.log('Result type:', typeof result);
            
            // If result is a string (JSON), parse it directly
            if (typeof result === 'string') {
                console.log('Result is a string, parsing as JSON');
                try {
                    const parsedResult = JSON.parse(result);
                    console.log('Successfully parsed JSON:', parsedResult);
                    return parsedResult;
                } catch (parseError) {
                    console.error('Failed to parse JSON:', parseError);
                    throw new Error('Failed to parse JSON result from Brython');
                }
            }
            
            throw new Error('Brython did not return a string result');
        } catch (error) {
            throw new Error(`Brython execution error: ${error.message}`);
        }
    }

    async fetchRData(dataName) {
        if (!window.webr) {
            throw new Error('WebR runtime not available');
        }

        const rCode = `
library(jsonlite)

tryCatch({
    # Get the data object
    df <- ${dataName}
    
    # Check if it's a data.frame or data.table
    if (inherits(df, "data.frame")) {
        # Convert to JSON records format
        result <- toJSON(df, dataframe="rows", auto_unbox=TRUE)
        result
    } else {
        # Try to convert to data.frame first
        df <- as.data.frame(df)
        result <- toJSON(df, dataframe="rows", auto_unbox=TRUE)
        result
    }
}, error = function(e) {
    toJSON(list(error = e$message))
})
`;

        try {
            console.log('Executing R code:', rCode);
            console.log('Using webr.evalR');
            
            const result = await window.webr.evalR(rCode);
            
            console.log('R execution result:', result);
            console.log('Result type:', typeof result);
            
            // If result is a string (JSON), parse it directly
            if (typeof result === 'string') {
                console.log('Result is a string, parsing as JSON');
                try {
                    const parsedResult = JSON.parse(result);
                    console.log('Successfully parsed JSON:', parsedResult);
                    return parsedResult;
                } catch (parseError) {
                    console.error('Failed to parse JSON:', parseError);
                    throw new Error('Failed to parse JSON result from R');
                }
            }
            
            throw new Error('R did not return a string result');
        } catch (error) {
            throw new Error(`R error: ${error.message}`);
        }
    }

    async fetchStataData(dataName) {
        if (!window.webr) {
            throw new Error('WebR runtime not available for Stata data');
        }

        const rCode = `
library(jsonlite)

tryCatch({
    # Get the Stata data object (assumed to be loaded in R)
    df <- ${dataName}
    
    # Convert to data.frame if it's not already
    if (!inherits(df, "data.frame")) {
        df <- as.data.frame(df)
    }
    
    # Convert to JSON records format
    result <- toJSON(df, dataframe="rows", auto_unbox=TRUE)
    result
}, error = function(e) {
    toJSON(list(error = e$message))
})
`;

        try {
            console.log('Executing Stata R code:', rCode);
            console.log('Using webr.evalR for Stata data');
            
            const result = await window.webr.evalR(rCode);
            
            console.log('Stata R execution result:', result);
            console.log('Result type:', typeof result);
            
            // If result is a string (JSON), parse it directly
            if (typeof result === 'string') {
                console.log('Result is a string, parsing as JSON');
                try {
                    const parsedResult = JSON.parse(result);
                    console.log('Successfully parsed JSON:', parsedResult);
                    return parsedResult;
                } catch (parseError) {
                    console.error('Failed to parse JSON:', parseError);
                    throw new Error('Failed to parse JSON result from Stata R');
                }
            }
            
            throw new Error('Stata R did not return a string result');
        } catch (error) {
            throw new Error(`Stata data error: ${error.message}`);
        }
    }

    parseResult(result) {
        console.log('parseResult called with:', result);
        console.log('Result type:', typeof result);
        console.log('Result value:', result);
        
        // If result is already an array of objects, return as-is
        if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object') {
            console.log('Result is already an array of objects, returning as-is');
            return result;
        }
        
        // If result is JSON string, parse it
        if (typeof result === 'string') {
            console.log('Result is a string, attempting to parse as JSON');
            try {
                const parsed = JSON.parse(result);
                if (parsed.error) {
                    throw new Error(parsed.error);
                }
                if (Array.isArray(parsed)) {
                    console.log('Successfully parsed JSON array');
                    return parsed;
                }
            } catch (e) {
                console.log('Failed to parse as JSON:', e.message);
                // Not JSON, might be CSV
            }
        }
        
        // If result is CSV string, parse to records
        if (typeof result === 'string' && result.includes(',')) {
            console.log('Result appears to be CSV, parsing to records');
            return this.csvToRecords(result);
        }
        
        console.log('Unable to parse result, throwing error');
        throw new Error('Unable to parse data into records format');
    }

    csvToRecords(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV must have at least a header and one data row');
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        const records = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const record = {};
            
            headers.forEach((header, index) => {
                record[header] = values[index] || '';
            });
            
            records.push(record);
        }
        
        return records;
    }

    validateData(data) {
        return Array.isArray(data) && 
               data.length > 0 && 
               typeof data[0] === 'object' && 
               !Array.isArray(data[0]);
    }

    isLikelyDataString(str) {
        if (!str || typeof str !== 'string') return false;
        
        const trimmed = str.trim();
        
        // Check if it looks like JSON
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            return true;
        }
        
        // Check if it looks like a URL (starts with http:// or https://)
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return true;
        }
        
        // Check if it looks like CSV (has commas and newlines)
        if (trimmed.includes(',') && trimmed.includes('\n')) {
            return true;
        }
        
        // Check if it looks like CSV (has commas and looks like data)
        if (trimmed.includes(',') && trimmed.split(',').length > 2) {
            return true;
        }
        
        return false;
    }

    showLoading() {
        if (this.loadingElement) {
            this.loadingElement.style.display = 'block';
        }
        if (this.pivotTable) {
            this.pivotTable.style.display = 'none';
        }
    }

    hideLoading() {
        if (this.loadingElement) {
            this.loadingElement.style.display = 'none';
        }
        if (this.pivotTable) {
            this.pivotTable.style.display = 'block';
        }
    }

    showError(message) {
        if (this.loadingElement) {
            this.loadingElement.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <div style="font-size: 18px; margin-bottom: 20px;">Error Loading Data</div>
                    <div style="font-size: 14px;">${message}</div>
                </div>
            `;
        }
    }

    renderPivotTable() {
        if (!this.dataLoaded || !this._data) return;
        
        // Hide loading
        this.hideLoading();
        
        // Clear existing pivot table
        if (this.pivotTable) {
            this.pivotTable.remove();
        }
        
        // Create container for pivot table
        this.pivotTable = document.createElement('div');
        this.pivotTable.style.width = '100%';
        this.pivotTable.style.height = '600px';
        this.appendChild(this.pivotTable);
        
        // Check if all required libraries are loaded
        if (typeof $ === 'undefined' || typeof $.pivotUtilities === 'undefined' || typeof $.fn.sortable === 'undefined') {
            this.loadPivotTableLibraries().then(() => {
                // Double-check that libraries are fully loaded
                if (typeof $ === 'undefined' || typeof $.pivotUtilities === 'undefined' || typeof $.fn.sortable === 'undefined') {
                    throw new Error('Libraries loaded but not fully initialized');
                }
                this.createPivotTable();
            }).catch(error => {
                console.error('Library loading failed:', error);
                this.showError(`Failed to load required libraries: ${error.message}. Please refresh and try again.`);
            });
        } else {
            this.createPivotTable();
        }
    }

    async loadPivotTableLibraries() {
        // Load jQuery if not present
        if (typeof $ === 'undefined') {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js');
        }
        
        // Load jQuery UI if not present (required for sortable functionality)
        if (typeof $.fn.sortable === 'undefined') {
            await this.loadCSS('https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.12.1/jquery-ui.min.css');
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.12.1/jquery-ui.min.js');
        }
        
        // Load PivotTable.js if not present
        if (typeof $.pivotUtilities === 'undefined') {
            await this.loadCSS('https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/pivot.min.css');
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/pivot.min.js');
        }
        
        // Load Plotly renderers if engine is plotly
        if (this._engine === 'plotly' && typeof $.pivotUtilities.plotly_renderers === 'undefined') {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/plotly_renderers.min.js');
        }
        
        // Wait a bit for all libraries to fully initialize
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    loadCSS(href) {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }

    createPivotTable() {
        try {
            // Ensure all required libraries are fully loaded
            if (typeof $ === 'undefined' || typeof $.pivotUtilities === 'undefined' || typeof $.fn.sortable === 'undefined') {
                throw new Error('Required libraries not fully loaded. Please wait and try again.');
            }
            
            // Prepare renderers
            let renderers = $.pivotUtilities.renderers;
            if (this._engine === 'plotly' && $.pivotUtilities.plotly_renderers) {
                renderers = $.extend($.pivotUtilities.renderers, $.pivotUtilities.plotly_renderers);
            }
            
            // Create pivot table configuration
            const config = {
                rows: this._rows,
                cols: this._cols,
                vals: this._vals,
                aggregatorName: this._aggregatorName,
                rendererName: this._rendererName,
                rendererOptions: this._rendererOptions,
                showUI: this._showUI,
                renderers: renderers,
                rowOrder: this._rowOrder,
                colOrder: this._colOrder,
                derivedAttributes: this._derivedAttributes,
                dataClass: this._dataClass,
                filter: this._filter,
                inclusions: this._inclusions,
                exclusions: this._exclusions,
                hiddenAttributes: this._hiddenAttributes,
                hiddenFromAggregators: this._hiddenFromAggregators,
                hiddenFromDragDrop: this._hiddenFromDragDrop,
                sorters: this._sorters,
                onRefresh: this._onRefresh,
                menuLimit: this._menuLimit,
                autoSortUnusedAttrs: this._autoSortUnusedAttrs,
                unusedAttrsVertical: this._unusedAttrsVertical,
                localeStrings: this._localeStrings
            };
            
            // Remove undefined values
            Object.keys(config).forEach(key => {
                if (config[key] === undefined || config[key] === null) {
                    delete config[key];
                }
            });
            
            // Create the pivot table
            $(this.pivotTable).pivotUI(this._data, config);
            
        } catch (error) {
            console.error('Error creating pivot table:', error);
            this.showError(`Failed to create pivot table: ${error.message}`);
        }
    }
}

// Register the pivot table component
console.log('Registering ui-pivot-table component');
customElements.define('ui-pivot-table', UIPivotTable);
console.log('ui-pivot-table component registered');

// Helper function to create pivot table elements
function createPivotTableElement(data, options = {}) {
    const element = document.createElement('ui-pivot-table');
    
    // Set data
    element.data = data;
    
    // Set other options
    if (options.rows) element.rows = options.rows;
    if (options.cols) element.cols = options.cols;
    if (options.vals) element.vals = options.vals;
    if (options.aggregatorName) element.aggregatorName = options.aggregatorName;
    if (options.rendererName) element.rendererName = options.rendererName;
    if (options.showUI !== undefined) element.showUI = options.showUI;
    if (options.language) element.language = options.language;
    if (options.engine) element.engine = options.engine;
    if (options.rendererOptions) element.rendererOptions = options.rendererOptions;
    
    return element;
}

// Make createPivotTableElement globally available
if (typeof window !== 'undefined') {
    window.createPivotTableElement = createPivotTableElement;
}

// Test component creation
console.log('Testing pivot table component creation...');
try {
    const testPivotTable = document.createElement('ui-pivot-table');
    console.log('Pivot table created successfully:', testPivotTable);
} catch (error) {
    console.error('Error creating pivot table component:', error);
}

// --- NEW: Plotly Figure Web Component ---
class PyPlotly extends HTMLElement {
    constructor() {
        super();
        this._figure = null; // { data, layout, config? }
        this._lastSignature = null;
        // Use light DOM (no shadow) to simplify styling/inspection
        // Ensure the host element has a sensible default size
        this.style.display = 'block';
        this.style.width = '100%';
        const container = document.createElement('div');
        container.style.width = '100%';
        // Default height similar to Brython plot defaults
        container.style.height = '420px';
        container.style.minHeight = '300px';
        this._container = container;
        this.appendChild(container);
        this._resizeObserver = null;
        console.log('[py-plotly] constructed');
    }

    static get observedAttributes() {
        return ['figure'];
    }

    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === 'figure') {
            try {
                this._figure = JSON.parse(newValue);
                console.log('[py-plotly] attributeChangedCallback figure set (attr):', this._figure);
                this._renderIfReady();
            } catch (e) {
                console.warn('[py-plotly] Failed to parse figure JSON:', e);
            }
        }
    }

    set figure(value) {
        this._figure = value;
        try {
            // Also reflect to attribute for visibility/debugging (may be large)
            // Avoid if extremely large; keep only layout.title if present
            const summary = { hasData: !!(value && value.data), title: value && value.layout && value.layout.title };
            this.setAttribute('data-figure-summary', JSON.stringify(summary));
        } catch (_) {}
        console.log('[py-plotly] figure property set:', this._figure);
        this._renderIfReady();
    }

    get figure() {
        return this._figure;
    }

    connectedCallback() {
        console.log('[py-plotly] connectedCallback');
        // If the figure attribute was set before upgrade, parse it now
        if (!this._figure) {
            const s = this.getAttribute('figure');
            if (s) {
                try {
                    this._figure = JSON.parse(s);
                    console.log('[py-plotly] parsed pre-upgrade figure attribute');
                } catch (e) {
                    console.warn('[py-plotly] failed to parse pre-upgrade figure attribute', e);
                }
            }
        }
        this._ensurePlotly().then(() => {
            console.log('[py-plotly] Plotly.js available');
            this._renderIfReady();
            // Resize handling
            if (!this._resizeObserver) {
                this._resizeObserver = new ResizeObserver(() => {
                    if (window.Plotly && this._container) {
                        try { window.Plotly.Plots.resize(this._container); } catch (_) {}
                    }
                });
                this._resizeObserver.observe(this);
            }
        });
    }

    disconnectedCallback() {
        if (this._resizeObserver) {
            try { this._resizeObserver.disconnect(); } catch (_) {}
            this._resizeObserver = null;
        }
        if (window.Plotly && this._container) {
            try { window.Plotly.purge(this._container); } catch (_) {}
        }
    }

    async _ensurePlotly() {
        if (typeof window.Plotly !== 'undefined') return;
        console.log('[py-plotly] Loading Plotly.js…');
        await new Promise((resolve, reject) => {
            const existing = document.querySelector('script[src*="plotly"]');
            if (existing) {
                console.log('[py-plotly] Found existing plotly script tag');
                if (existing.readyState === 'complete' || existing.readyState === 'loaded') {
                    resolve();
                } else {
                    existing.addEventListener('load', () => resolve(), { once: true });
                    existing.addEventListener('error', reject, { once: true });
                }
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdn.plot.ly/plotly-2.32.0.min.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = (e) => reject(e);
            document.head.appendChild(script);
        });
        console.log('[py-plotly] Plotly.js loaded');
    }

    _renderIfReady() {
        if (!this.isConnected || !this._figure || typeof window.Plotly === 'undefined') return;
        const { data, layout, config } = this._figure;
        console.log('[py-plotly] rendering with figure:', { hasData: !!(data && data.length), layout });
        try {
            // Apply layout-driven sizing if provided; otherwise keep default 420px
            try {
                if (layout && typeof layout.height === 'number' && layout.height > 0) {
                    this._container.style.height = `${layout.height}px`;
                }
                if (layout && typeof layout.width === 'number' && layout.width > 0) {
                    this._container.style.width = `${layout.width}px`;
                }
            } catch (_) {}
            // Skip duplicate renders if figure signature unchanged
            try {
                const sig = JSON.stringify({ n: Array.isArray(data) ? data.length : 0, t: Array.isArray(data) && data[0] && data[0].type, title: layout && layout.title });
                if (this._lastSignature === sig) {
                    console.log('[py-plotly] skip render (same signature)');
                    return;
                }
                this._lastSignature = sig;
            } catch (_) {}

            // Purge previous plot to prevent duplicate subplots on re-render
            try { window.Plotly.purge(this._container); } catch (_) {}
            window.Plotly.newPlot(this._container, data || [], layout || {}, config || { responsive: true });
            console.log('[py-plotly] render complete');
        } catch (e) {
            console.error('[py-plotly] Render error:', e);
        }
    }
}

customElements.define('py-plotly', PyPlotly);

// UI Drawcast Component - Screen Recording with Drawing, Camera, and Audio
class UIDrawcast extends HTMLElement {
    static get observedAttributes() {
        return ['max_seconds', 'record_audio', 'record_camera', 'record_canvas', 'canvas_width', 'canvas_height', 'background_color'];
    }

    constructor() {
        super();
        // Sensible defaults for immediate use
        this._maxSeconds = parseInt(this.getAttribute('max_seconds')) || 300; // 5 minutes default
        this._recordAudio = this.getAttribute('record_audio') !== 'false'; // Default to true
        this._recordCamera = this.getAttribute('record_camera') === 'true'; // Default to false
        this._recordCanvas = this.getAttribute('record_canvas') !== 'false'; // Default to true
        this._canvasWidth = parseInt(this.getAttribute('canvas_width')) || 640; // Smaller default
        this._canvasHeight = parseInt(this.getAttribute('canvas_height')) || 480; // Smaller default
        this._backgroundColor = this.getAttribute('background_color') || '#ffffff'; // White background default
        
        // State variables
        this.isDrawing = false;
        this.brushColor = '#000000';
        this.brushSize = 5;
        this.drawingPath = [];
        this.isRecording = false;
        this.recordingTimer = null;
        this.timeWarningShown = false;
        
        // Media variables
        this.videoRecorder = null;
        this.videoChunks = [];
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.cameraStream = null;
        this.audioStream = null;
        
        // Firebase variables
        this.currentUser = null;
        this.recordingId = null;
        
        this.rendered = false;
    }

    // Getters and setters
    get maxSeconds() { return this._maxSeconds; }
    set maxSeconds(value) { 
        this._maxSeconds = parseInt(value) || 180; 
        if (this.rendered) this.updateTimeWarning();
    }

    get recordAudio() { return this._recordAudio; }
    set recordAudio(value) { 
        this._recordAudio = value !== 'false' && value !== false; 
        if (this.rendered) this.updateCheckboxes();
    }

    get recordCamera() { return this._recordCamera; }
    set recordCamera(value) { 
        this._recordCamera = value === 'true' || value === true; 
        if (this.rendered) this.updateCheckboxes();
    }

    get recordCanvas() { return this._recordCanvas; }
    set recordCanvas(value) { 
        this._recordCanvas = value !== 'false' && value !== false; 
        if (this.rendered) this.updateCheckboxes();
    }

    get canvasWidth() { return this._canvasWidth; }
    set canvasWidth(value) { 
        this._canvasWidth = parseInt(value) || 854; 
        if (this.rendered) this.updateCanvasSize();
    }

    get canvasHeight() { return this._canvasHeight; }
    set canvasHeight(value) { 
        this._canvasHeight = parseInt(value) || 480; 
        if (this.rendered) this.updateCanvasSize();
    }

    get backgroundColor() { return this._backgroundColor; }
    set backgroundColor(value) { 
        this._backgroundColor = value; 
        if (this.rendered) this.updateCanvasBackground();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this[name] = newValue;
        }
    }

    connectedCallback() {
        this.render();
        this.rendered = true;
        this.initializeFirebase();
    }

    async initializeFirebase() {
        // Check if Firebase is available
        if (typeof firebase !== 'undefined' && firebase.auth) {
            this.currentUser = firebase.auth().currentUser;
            
            // Listen for auth state changes
            firebase.auth().onAuthStateChanged((user) => {
                this.currentUser = user;
                this.updateAuthUI();
                console.log('Firebase auth state changed:', user ? `User: ${user.uid}` : 'No user');
            });
            
            console.log('Firebase initialized successfully');
            console.log('Current user:', this.currentUser ? this.currentUser.uid : 'None');
            
            // Test Firebase Storage access
            if (firebase.storage) {
                try {
                    const testRef = firebase.storage().ref(`notebooks/${this.currentUser?.uid || 'test'}/test.txt`);
                    console.log('Firebase Storage reference created successfully');
                } catch (error) {
                    console.error('Firebase Storage reference creation failed:', error);
                }
            }
        } else {
            console.warn('Firebase not available. Recording functionality will be limited.');
        }
    }

    updateAuthUI() {
        const saveButton = this.querySelector('#saveButton');
        if (saveButton) {
            saveButton.style.display = this.currentUser ? 'inline' : 'none';
        }
    }

    render() {
        this.innerHTML = '';
        
        // Main container
        const container = document.createElement('div');
        container.classList.add('card-default');
        container.style.padding = '20px';
        container.style.maxWidth = '100%';
        container.style.overflow = 'hidden';

        // Top controls
        const topControls = document.createElement('div');
        topControls.id = 'topControls';
        topControls.style.display = 'flex';
        topControls.style.justifyContent = 'center';
        topControls.style.marginBottom = '15px';
        topControls.style.gap = '10px';

        const startButton = document.createElement('button');
        startButton.id = 'startButton';
        startButton.textContent = 'Start Recording';
        startButton.classList.add('button-default');
        startButton.addEventListener('click', () => this.startRecording());

        const stopButton = document.createElement('button');
        stopButton.id = 'stopButton';
        stopButton.textContent = 'Stop';
        stopButton.classList.add('button-default');
        stopButton.style.display = 'none';
        stopButton.addEventListener('click', () => this.stopRecording());

        const pauseButton = document.createElement('button');
        pauseButton.id = 'pauseButton';
        pauseButton.textContent = 'Pause';
        pauseButton.classList.add('button-default');
        pauseButton.style.display = 'none';
        pauseButton.addEventListener('click', () => this.togglePause());

        const resumeButton = document.createElement('button');
        resumeButton.id = 'resumeButton';
        resumeButton.textContent = 'Resume';
        resumeButton.classList.add('button-default');
        resumeButton.style.display = 'none';
        resumeButton.addEventListener('click', () => this.togglePause());

        topControls.appendChild(startButton);
        topControls.appendChild(stopButton);
        topControls.appendChild(pauseButton);
        topControls.appendChild(resumeButton);

        // Canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.id = 'canvasContainer';
        canvasContainer.style.display = 'flex';
        canvasContainer.style.justifyContent = 'center';
        canvasContainer.style.alignItems = 'center';
        canvasContainer.style.position = 'relative';
        canvasContainer.style.margin = '0 auto';

        // Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'canvas';
        this.canvas.width = this._canvasWidth;
        this.canvas.height = this._canvasHeight;
        this.canvas.style.border = '2px solid #ccc';
        this.canvas.style.cursor = 'crosshair';
        this.canvas.style.touchAction = 'none';

        // Camera video
        this.cameraVideo = document.createElement('video');
        this.cameraVideo.id = 'cameraVideo';
        this.cameraVideo.autoplay = true;
        this.cameraVideo.style.position = 'absolute';
        this.cameraVideo.style.width = '200px';
        this.cameraVideo.style.height = '150px';
        this.cameraVideo.style.bottom = '10px';
        this.cameraVideo.style.right = '10px';
        this.cameraVideo.style.border = '2px solid white';
        this.cameraVideo.style.display = this._recordCamera ? 'block' : 'none';

        // Drawing tools
        const toolsContainer = document.createElement('div');
        toolsContainer.id = 'toolsContainer';
        toolsContainer.style.display = 'flex';
        toolsContainer.style.flexDirection = 'column';
        toolsContainer.style.justifyContent = 'center';
        toolsContainer.style.alignItems = 'center';
        toolsContainer.style.marginLeft = '20px';
        toolsContainer.style.gap = '5px';

        // Color buttons
        const colors = ['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#FFFF00', '#FF00FF', '#00FFFF'];
        colors.forEach(color => {
            const colorBtn = document.createElement('div');
            colorBtn.className = 'colorButton';
            colorBtn.style.width = '30px';
            colorBtn.style.height = '30px';
            colorBtn.style.backgroundColor = color;
            colorBtn.style.border = '2px solid black';
            colorBtn.style.borderRadius = '50%';
            colorBtn.style.cursor = 'pointer';
            colorBtn.style.borderColor = color === this.brushColor ? '#00FF00' : 'black';
            colorBtn.addEventListener('click', () => this.setBrushColor(color));
            toolsContainer.appendChild(colorBtn);
        });

        // Brush size controls
        const brushControls = document.createElement('div');
        brushControls.style.display = 'flex';
        brushControls.style.alignItems = 'center';
        brushControls.style.gap = '5px';
        brushControls.style.marginTop = '10px';

        const decreaseBtn = document.createElement('button');
        decreaseBtn.textContent = '−';
        decreaseBtn.style.width = '30px';
        decreaseBtn.style.height = '30px';
        decreaseBtn.addEventListener('click', () => this.changeBrushSize(-1));

        const brushSizeDisplay = document.createElement('span');
        brushSizeDisplay.id = 'brushSizeDisplay';
        brushSizeDisplay.textContent = this.brushSize;
        brushSizeDisplay.style.minWidth = '20px';
        brushSizeDisplay.style.textAlign = 'center';

        const increaseBtn = document.createElement('button');
        increaseBtn.textContent = '+';
        increaseBtn.style.width = '30px';
        increaseBtn.style.height = '30px';
        increaseBtn.addEventListener('click', () => this.changeBrushSize(1));

        brushControls.appendChild(decreaseBtn);
        brushControls.appendChild(brushSizeDisplay);
        brushControls.appendChild(increaseBtn);

        // Action buttons
        const actionButtons = document.createElement('div');
        actionButtons.style.display = 'flex';
        actionButtons.style.flexDirection = 'column';
        actionButtons.style.gap = '5px';
        actionButtons.style.marginTop = '10px';

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '🗑️ Clear';
        clearBtn.addEventListener('click', () => this.clearCanvas());

        const textBtn = document.createElement('button');
        textBtn.textContent = 'T Text';
        textBtn.addEventListener('click', () => this.activateTextTool());

        const exportBtn = document.createElement('button');
        exportBtn.textContent = '💾 Export';
        exportBtn.addEventListener('click', () => this.showExportOptions());

        actionButtons.appendChild(clearBtn);
        actionButtons.appendChild(textBtn);
        actionButtons.appendChild(exportBtn);

        toolsContainer.appendChild(brushControls);
        toolsContainer.appendChild(actionButtons);

        // Bottom controls
        const bottomControls = document.createElement('div');
        bottomControls.id = 'bottomControls';
        bottomControls.style.display = 'flex';
        bottomControls.style.justifyContent = 'center';
        bottomControls.style.marginTop = '15px';
        bottomControls.style.gap = '15px';
        bottomControls.style.alignItems = 'center';

        const canvasCheckbox = document.createElement('input');
        canvasCheckbox.type = 'checkbox';
        canvasCheckbox.id = 'canvasCheckbox';
        canvasCheckbox.checked = this._recordCanvas;
        canvasCheckbox.addEventListener('change', (e) => {
            this._recordCanvas = e.target.checked;
            this.updateCanvasVisibility();
        });

        const canvasLabel = document.createElement('label');
        canvasLabel.htmlFor = 'canvasCheckbox';
        canvasLabel.textContent = 'Canvas';

        const cameraCheckbox = document.createElement('input');
        cameraCheckbox.type = 'checkbox';
        cameraCheckbox.id = 'cameraCheckbox';
        cameraCheckbox.checked = this._recordCamera;
        cameraCheckbox.addEventListener('change', async (e) => {
            this._recordCamera = e.target.checked;
            await this.updateCameraVisibility();
        });

        const cameraLabel = document.createElement('label');
        cameraLabel.htmlFor = 'cameraCheckbox';
        cameraLabel.textContent = 'Camera';

        const audioCheckbox = document.createElement('input');
        audioCheckbox.type = 'checkbox';
        audioCheckbox.id = 'audioCheckbox';
        audioCheckbox.checked = this._recordAudio;
        audioCheckbox.addEventListener('change', (e) => {
            this._recordAudio = e.target.checked;
        });

        const audioLabel = document.createElement('label');
        audioLabel.htmlFor = 'audioCheckbox';
        audioLabel.textContent = 'Audio';

        bottomControls.appendChild(canvasCheckbox);
        bottomControls.appendChild(canvasLabel);
        bottomControls.appendChild(cameraCheckbox);
        bottomControls.appendChild(cameraLabel);
        bottomControls.appendChild(audioCheckbox);
        bottomControls.appendChild(audioLabel);

        // Time warning
        const timeWarning = document.createElement('div');
        timeWarning.id = 'timeWarning';
        timeWarning.style.display = 'none';
        timeWarning.style.color = '#FF6B35';
        timeWarning.style.fontWeight = 'bold';
        timeWarning.style.textAlign = 'center';
        timeWarning.style.marginTop = '10px';

        // Video player (initially hidden)
        this.videoPlayer = document.createElement('video');
        this.videoPlayer.id = 'videoPlayer';
        this.videoPlayer.controls = true;
        this.videoPlayer.style.display = 'none';
        this.videoPlayer.style.width = '100%';
        this.videoPlayer.style.maxWidth = this._canvasWidth + 'px';

        // Save button will be created dynamically after recording

        // Assemble the component
        canvasContainer.appendChild(this.canvas);
        canvasContainer.appendChild(this.cameraVideo);
        canvasContainer.appendChild(toolsContainer);

        container.appendChild(topControls);
        container.appendChild(canvasContainer);
        container.appendChild(bottomControls);
        container.appendChild(timeWarning);
        container.appendChild(this.videoPlayer);

        // Add helpful info for default configuration
        if (!this.hasAttribute('max_seconds') && !this.hasAttribute('record_audio') && 
            !this.hasAttribute('record_camera') && !this.hasAttribute('record_canvas') &&
            !this.hasAttribute('canvas_width') && !this.hasAttribute('canvas_height') &&
            !this.hasAttribute('background_color')) {
            
            // Info box removed - no more "Ready to Record" message
        }

        this.appendChild(container);

        // Initialize canvas and event listeners
        this.initializeCanvas();
        this.setupEventListeners();
        this.updateCanvasBackground();
        this.updateTimeWarning();
    }

    initializeCanvas() {
        this.ctx = this.canvas.getContext('2d');
        this.ctx.fillStyle = this._backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Set initial drawing styles
        this.ctx.strokeStyle = this.brushColor;
        this.ctx.lineWidth = this.brushSize;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    setupEventListeners() {
        // Canvas drawing events
        this.canvas.addEventListener('pointerdown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('pointermove', (e) => this.draw(e));
        this.canvas.addEventListener('pointerup', (e) => this.stopDrawing(e));
        this.canvas.addEventListener('pointercancel', (e) => this.stopDrawing(e));

        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    startDrawing(e) {
        if (!this._recordCanvas) return;
        e.preventDefault();
        this.isDrawing = true;
        const { offsetX, offsetY } = this.getEventCoords(e);
        this.drawingPath = [{ x: offsetX, y: offsetY }];
        this.ctx.beginPath();
        this.ctx.moveTo(offsetX, offsetY);
        this.canvas.setPointerCapture(e.pointerId);
    }

    draw(e) {
        if (!this.isDrawing) return;
        e.preventDefault();

        const { offsetX, offsetY } = this.getEventCoords(e);
        const newPoint = { x: offsetX, y: offsetY };
        this.drawingPath.push(newPoint);

        if (this.drawingPath.length > 2) {
            const p1 = this.drawingPath[this.drawingPath.length - 2];
            const p2 = this.drawingPath[this.drawingPath.length - 1];

            const smoothedPoint = {
                x: 0.5 * (p1.x + p2.x),
                y: 0.5 * (p1.y + p2.y),
            };

            this.ctx.strokeStyle = this.brushColor;
            this.ctx.lineWidth = this.brushSize;
            this.ctx.lineTo(smoothedPoint.x, smoothedPoint.y);
            this.ctx.stroke();
        }
    }

    stopDrawing(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this.ctx.closePath();
        this.drawingPath = [];
        this.canvas.releasePointerCapture(e.pointerId);
    }

    getEventCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
        };
    }

    setBrushColor(color) {
        this.brushColor = color;
        this.ctx.strokeStyle = color;
        
        // Update color button borders
        this.querySelectorAll('.colorButton').forEach(btn => {
            btn.style.borderColor = btn.style.backgroundColor === color ? '#00FF00' : 'black';
        });
    }

    changeBrushSize(delta) {
        this.brushSize = Math.max(1, Math.min(50, this.brushSize + delta));
        this.ctx.lineWidth = this.brushSize;
        this.querySelector('#brushSizeDisplay').textContent = this.brushSize;
    }

    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = this._backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    activateTextTool() {
        const text = prompt('Enter text:');
        if (text) {
            const x = this.canvas.width / 2;
            const y = this.canvas.height / 2;
            
            this.ctx.font = `${this.brushSize * 3}px Arial`;
            this.ctx.fillStyle = this.brushColor;
            this.ctx.textAlign = 'center';
            this.ctx.fillText(text, x, y);
        }
    }

    showExportOptions() {
        const format = prompt('Export format (png/jpeg/svg):', 'png');
        if (format) {
            this.exportCanvas(format.toLowerCase());
        }
    }

    exportCanvas(format) {
        switch (format) {
            case 'png':
                this.downloadCanvas('png', 'image/png');
                break;
            case 'jpeg':
                this.downloadCanvas('jpeg', 'image/jpeg', 0.8);
                break;
            case 'svg':
                this.exportAsSVG();
                break;
            default:
                alert('Unsupported format. Use png, jpeg, or svg.');
        }
    }

    downloadCanvas(format, mimeType, quality = 1.0) {
        const link = document.createElement('a');
        link.download = `drawing.${format}`;
        link.href = this.canvas.toDataURL(mimeType, quality);
        link.click();
    }

    exportAsSVG() {
        // Simple SVG export - can be enhanced
        const svgData = `<svg width="${this.canvas.width}" height="${this.canvas.height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="${this._backgroundColor}"/>
            <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="${this.brushColor}">Canvas Export</text>
        </svg>`;
        
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'drawing.svg';
        link.click();
        URL.revokeObjectURL(url);
    }

    updateCanvasSize() {
        this.canvas.width = this._canvasWidth;
        this.canvas.height = this._canvasHeight;
        this.initializeCanvas();
    }

    updateCanvasBackground() {
        this.ctx.fillStyle = this._backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    updateCanvasVisibility() {
        this.canvas.style.display = this._recordCanvas ? 'block' : 'none';
    }

    async updateCameraVisibility() {
        if (this._recordCamera) {
            try {
                this.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
                this.cameraVideo.srcObject = this.cameraStream;
                this.cameraVideo.style.display = 'block';
            } catch (err) {
                console.error('Camera access error:', err);
                alert('Could not access camera. Please check permissions.');
                this._recordCamera = false;
                this.querySelector('#cameraCheckbox').checked = false;
            }
        } else {
            if (this.cameraStream) {
                this.cameraStream.getTracks().forEach(track => track.stop());
                this.cameraStream = null;
            }
            this.cameraVideo.style.display = 'none';
        }
    }

    updateCheckboxes() {
        this.querySelector('#canvasCheckbox').checked = this._recordCanvas;
        this.querySelector('#cameraCheckbox').checked = this._recordCamera;
        this.querySelector('#audioCheckbox').checked = this._recordAudio;
    }

    updateTimeWarning() {
        const timeWarning = this.querySelector('#timeWarning');
        if (this._maxSeconds <= 60) {
            timeWarning.textContent = `Recording limited to ${this._maxSeconds} seconds`;
            timeWarning.style.display = 'block';
        } else {
            timeWarning.style.display = 'none';
        }
    }

    async startRecording() {
        if (!this.currentUser) {
            alert('Please log in to record.');
            return;
        }

        // Hide controls
        this.querySelector('#bottomControls').style.display = 'none';
        this.querySelector('#startButton').style.display = 'none';
        this.querySelector('#stopButton').style.display = 'inline';
        this.querySelector('#pauseButton').style.display = 'inline';
        
        this.isRecording = true;
        this.audioChunks = [];
        this.videoChunks = [];
        this.timeWarningShown = false;

        try {
            let combinedStream;
            
            // Get audio stream if enabled
            if (this._recordAudio) {
                this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            if (this._recordCanvas) {
                const canvasStream = this.canvas.captureStream();

                if (this._recordCamera && this.cameraStream) {
                    // Combine canvas and camera
                    const offscreenCanvas = document.createElement('canvas');
                    const ctx = offscreenCanvas.getContext('2d');
                    offscreenCanvas.width = this.canvas.width;
                    offscreenCanvas.height = this.canvas.height;

                    const drawCanvasAndCamera = () => {
                        if (!this.isRecording) return;
                        
                        ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
                        ctx.drawImage(this.canvas, 0, 0);
                        
                        // Draw camera in bottom-right corner
                        ctx.drawImage(this.cameraVideo, 
                            offscreenCanvas.width - 200 - 10, 
                            offscreenCanvas.height - 150 - 10, 
                            200, 150);

                        requestAnimationFrame(drawCanvasAndCamera);
                    };

                    drawCanvasAndCamera();
                    combinedStream = offscreenCanvas.captureStream();
                } else {
                    combinedStream = canvasStream;
                }
            } else if (this._recordCamera && this.cameraStream) {
                combinedStream = new MediaStream(this.cameraStream.getTracks());
            }

            // Add audio track if available
            if (this.audioStream) {
                combinedStream.addTrack(this.audioStream.getAudioTracks()[0]);
            }

            // Create MediaRecorder with WebM support and MP4 fallback
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
                ? 'video/webm;codecs=vp9' 
                : MediaRecorder.isTypeSupported('video/webm') 
                    ? 'video/webm' 
                    : 'video/mp4';

            this.videoRecorder = new MediaRecorder(combinedStream, { mimeType });

            this.videoRecorder.ondataavailable = (event) => {
                this.videoChunks.push(event.data);
            };

            this.videoRecorder.onstop = async () => {
                await this.handleRecordingComplete();
            };

            this.videoRecorder.start();

            // Start timer
            this.recordingTimer = setInterval(() => {
                this.updateRecordingTimer();
            }, 1000);

        } catch (error) {
            console.error('Recording error:', error);
            alert('Failed to start recording: ' + error.message);
            this.stopRecording();
        }
    }

    updateRecordingTimer() {
        const elapsed = this.videoChunks.length; // Rough estimate
        const remaining = this._maxSeconds - elapsed;
        
        if (remaining <= 30 && !this.timeWarningShown) {
            this.showTimeWarning(remaining);
            this.timeWarningShown = true;
        }
        
        if (remaining <= 0) {
            this.stopRecording();
        }
    }

    showTimeWarning(remaining) {
        const timeWarning = this.querySelector('#timeWarning');
        timeWarning.textContent = `⚠️ Recording will stop in ${remaining} seconds`;
        timeWarning.style.display = 'block';
        timeWarning.style.color = '#FF0000';
    }

    stopRecording() {
        if (this.videoRecorder && this.videoRecorder.state !== 'inactive') {
            this.videoRecorder.stop();
        }
        
        this.isRecording = false;
        clearInterval(this.recordingTimer);
        
        // Show controls
        this.querySelector('#bottomControls').style.display = 'flex';
        this.querySelector('#startButton').style.display = 'inline';
        this.querySelector('#stopButton').style.display = 'none';
        this.querySelector('#pauseButton').style.display = 'none';
        this.querySelector('#resumeButton').style.display = 'none';
        
        // Hide time warning
        this.querySelector('#timeWarning').style.display = 'none';
    }

    togglePause() {
        if (!this.videoRecorder) return;

        if (this.videoRecorder.state === 'recording') {
            this.videoRecorder.pause();
            this.querySelector('#pauseButton').style.display = 'none';
            this.querySelector('#resumeButton').style.display = 'inline';
        } else if (this.videoRecorder.state === 'paused') {
            this.videoRecorder.resume();
            this.querySelector('#pauseButton').style.display = 'inline';
            this.querySelector('#resumeButton').style.display = 'none';
        }
    }

    async handleRecordingComplete() {
        try {
            const videoBlob = new Blob(this.videoChunks, { type: 'video/webm' });
            const videoUrl = URL.createObjectURL(videoBlob);

                    // Hide all drawing-related elements
        this.querySelector('#canvasContainer').style.display = 'none';
        this.querySelector('#topControls').style.display = 'none';
        this.querySelector('#bottomControls').style.display = 'none';
        this.querySelector('#timeWarning').style.display = 'none';
        


            // Show video player
            this.videoPlayer.src = videoUrl;
            this.videoPlayer.style.display = 'block';
            this.videoPlayer.style.width = '100%';
            this.videoPlayer.style.maxWidth = this._canvasWidth + 'px';
            
            // Store video blob for later use
            this.recordedVideoBlob = videoBlob;
            
            // Add data attributes to video element for easy access
            this.videoPlayer.setAttribute('data-recording-id', this.recordingId);
            this.videoPlayer.setAttribute('data-recording-title', 'Unnamed Recording');
            this.videoPlayer.setAttribute('data-recording-timestamp', new Date().toISOString());
            this.videoPlayer.setAttribute('data-user-id', this.currentUser?.uid || 'anonymous');
            
            // Ensure video player is properly positioned
            this.videoPlayer.style.margin = '0 auto';
            this.videoPlayer.style.display = 'block';

                        // Create button container above video
            let buttonContainer = this.querySelector('#postRecordingButtons');
            if (!buttonContainer) {
                buttonContainer = document.createElement('div');
                buttonContainer.id = 'postRecordingButtons';
                buttonContainer.style.display = 'flex';
                buttonContainer.style.justifyContent = 'center';
                buttonContainer.style.alignItems = 'center';
                buttonContainer.style.gap = '8px';
                buttonContainer.style.marginBottom = '15px';
                buttonContainer.style.flexWrap = 'wrap';
                buttonContainer.style.padding = '10px';
                
                // Save button
                const saveButton = document.createElement('button');
                saveButton.id = 'saveButton';
                saveButton.innerHTML = '💾 Save';
                saveButton.classList.add('button-default');
                saveButton.style.backgroundColor = 'transparent';
                saveButton.style.color = '#333';
                saveButton.style.border = '1px solid #ccc';
                saveButton.style.padding = '8px 16px';
                saveButton.style.borderRadius = '4px';
                saveButton.style.cursor = 'pointer';
                saveButton.style.fontSize = '14px';
                saveButton.addEventListener('click', () => this.showSaveDialog());
                this.addButtonHoverEffects(saveButton);
                
                // Download button
                const downloadButton = document.createElement('button');
                downloadButton.id = 'downloadButton';
                downloadButton.innerHTML = '⬇️ Download';
                downloadButton.classList.add('button-default');
                downloadButton.style.backgroundColor = 'transparent';
                downloadButton.style.color = '#333';
                downloadButton.style.border = '1px solid #ccc';
                downloadButton.style.padding = '8px 16px';
                downloadButton.style.borderRadius = '4px';
                downloadButton.style.cursor = 'pointer';
                downloadButton.style.fontSize = '14px';
                downloadButton.addEventListener('click', () => this.downloadRecording());
                this.addButtonHoverEffects(downloadButton);
                
                // Re-record button
                const rerecordButton = document.createElement('button');
                rerecordButton.id = 'rerecordButton';
                rerecordButton.innerHTML = '🔄 Re-record';
                rerecordButton.classList.add('button-default');
                rerecordButton.style.backgroundColor = 'transparent';
                rerecordButton.style.color = '#333';
                rerecordButton.style.border = '1px solid #ccc';
                rerecordButton.style.padding = '8px 16px';
                rerecordButton.style.borderRadius = '4px';
                rerecordButton.style.cursor = 'pointer';
                rerecordButton.style.fontSize = '14px';
                rerecordButton.addEventListener('click', () => this.resetToRecordingMode());
                this.addButtonHoverEffects(rerecordButton);
                
                // Cancel button
                const cancelButton = document.createElement('button');
                cancelButton.id = 'cancelButton';
                cancelButton.innerHTML = '❌ Cancel';
                cancelButton.classList.add('button-default');
                cancelButton.style.backgroundColor = 'transparent';
                cancelButton.style.color = '#333';
                cancelButton.style.border = '1px solid #ccc';
                cancelButton.style.padding = '8px 16px';
                cancelButton.style.borderRadius = '4px';
                cancelButton.style.cursor = 'pointer';
                cancelButton.style.fontSize = '14px';
                cancelButton.addEventListener('click', () => this.resetToRecordingMode());
                this.addButtonHoverEffects(cancelButton);
                
                // Add all buttons to container
                buttonContainer.appendChild(saveButton);
                buttonContainer.appendChild(downloadButton);
                buttonContainer.appendChild(rerecordButton);
                buttonContainer.appendChild(cancelButton);
                
                // Add button container to the main container
                this.appendChild(buttonContainer);
                console.log('Button container created and inserted above video');
            } else {
                buttonContainer.style.display = 'flex';
                console.log('Button container already exists, showing it');
            }
            
            console.log('Button container display style:', buttonContainer.style.display);
            console.log('Button container visibility:', buttonContainer.offsetParent !== null);

            // Store video blob for later upload
            this.recordedVideoBlob = videoBlob;

        } catch (error) {
            console.error('Error handling recording completion:', error);
            alert('Error processing recording: ' + error.message);
        }
    }

    resetToRecordingMode() {
        // Clear the recorded video
        this.recordedVideoBlob = null;
        
        // Hide video player and button container
        this.videoPlayer.style.display = 'none';
        this.querySelector('#postRecordingButtons').style.display = 'none';
        
        // Show all drawing-related elements
        this.querySelector('#canvasContainer').style.display = 'flex';
        this.querySelector('#topControls').style.display = 'flex';
        this.querySelector('#bottomControls').style.display = 'flex';
        

        
        // Reset canvas
        this.clearCanvas();
        
        // Reset recording state
        this.isRecording = false;
        this.videoChunks = [];
        this.audioChunks = [];
    }

    downloadRecording() {
        if (!this.recordedVideoBlob) {
            alert('No recording available to download');
            return;
        }
        
        // Create download link
        const url = URL.createObjectURL(this.recordedVideoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording_${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Also download the canvas as PNG
        const canvasUrl = this.canvas.toDataURL('image/png');
        const canvasA = document.createElement('a');
        canvasA.href = canvasUrl;
        canvasA.download = `drawing_${Date.now()}.png`;
        document.body.appendChild(canvasA);
        canvasA.click();
        document.body.removeChild(canvasA);
        
        alert('Recording and drawing downloaded successfully!');
    }

    addButtonHoverEffects(button) {
        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#f8f9fa';
            button.style.borderColor = '#999';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'transparent';
            button.style.borderColor = '#ccc';
        });
    }
    


    showSaveDialog() {
        // Check Firebase availability first
        if (typeof firebase === 'undefined') {
            alert('Firebase is not available. Please ensure Firebase is properly configured.');
            return;
        }
        
        if (!this.currentUser) {
            alert('Please log in to Firebase before saving recordings.');
            return;
        }

        // Create modal overlay
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '1000';

        const dialog = document.createElement('div');
        dialog.style.backgroundColor = 'white';
        dialog.style.padding = '30px';
        dialog.style.borderRadius = '10px';
        dialog.style.minWidth = '400px';
        dialog.style.maxWidth = '600px';

        dialog.innerHTML = `
            <h3 style="margin-top: 0;">Save Recording</h3>
            <div style="margin-bottom: 15px;">
                <label for="titleInput" style="display: block; margin-bottom: 5px; font-weight: bold;">Title *</label>
                <input type="text" id="titleInput" placeholder="Enter recording title" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" required>
            </div>
            <div style="margin-bottom: 15px;">
                <label for="descriptionInput" style="display: block; margin-bottom: 5px;">Description (optional)</label>
                <textarea id="descriptionInput" placeholder="Enter description" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; height: 80px; resize: vertical;"></textarea>
            </div>
            <div style="margin-bottom: 15px;">
                <label for="notebookInput" style="display: block; margin-bottom: 5px;">Notebook ID (optional)</label>
                <input type="text" id="notebookInput" placeholder="Enter notebook ID" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cancelSave" style="padding: 10px 20px; border: 1px solid #ccc; background: #f8f9fa; cursor: pointer; border-radius: 4px;">Cancel</button>
                <button id="confirmSave" style="padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 4px;">Save</button>
            </div>
        `;

        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // Event listeners
        const titleInput = dialog.querySelector('#titleInput');
        const descriptionInput = dialog.querySelector('#descriptionInput');
        const notebookInput = dialog.querySelector('#notebookInput');
        const cancelBtn = dialog.querySelector('#cancelSave');
        const confirmBtn = dialog.querySelector('#confirmSave');

        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        confirmBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            if (!title) {
                alert('Please enter a title.');
                return;
            }

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Saving...';

            try {
                await this.saveRecording(title, descriptionInput.value.trim(), notebookInput.value.trim());
                document.body.removeChild(modal);
            } catch (error) {
                alert('Failed to save: ' + error.message);
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Save';
            }
        });

        // Focus on title input
        titleInput.focus();
    }

    async saveRecording(title, description, notebookId) {
        if (!this.currentUser || !this.recordedVideoBlob) {
            throw new Error('User not logged in or no recording available');
        }

        try {
            // Generate recording ID
            const timestamp = Date.now();
            const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            this.recordingId = `${timestamp}_${sanitizedTitle}`;

            // Create thumbnail
            const thumbnailBlob = await this.createThumbnail();
            
            // Try multiple storage paths to find one that works
            let videoUrl, thumbnailUrl;
            let storagePath = '';
            
            console.log('Current user ID:', this.currentUser.uid);
            console.log('Recording ID:', this.recordingId);
            
            try {
                // Use the notebooks path that matches your Firebase Storage rules
                const videoRef = firebase.storage().ref(`notebooks/${this.currentUser.uid}/video_${this.recordingId}.webm`);
                const thumbnailRef = firebase.storage().ref(`notebooks/${this.currentUser.uid}/thumb_${this.recordingId}.png`);
                
                console.log('Attempting notebooks path...');
                console.log('Video ref path:', videoRef.fullPath);
                console.log('Thumbnail ref path:', thumbnailRef.fullPath);
                console.log('User ID:', this.currentUser.uid);
                console.log('Recording ID:', this.recordingId);
                
                const [videoSnapshot, thumbnailSnapshot] = await Promise.all([
                    videoRef.put(this.recordedVideoBlob),
                    thumbnailRef.put(thumbnailBlob)
                ]);
                
                videoUrl = await videoSnapshot.ref.getDownloadURL();
                thumbnailUrl = await thumbnailSnapshot.ref.getDownloadURL();
                storagePath = 'notebooks';
                
                console.log('Successfully saved to notebooks path');
                console.log('Video URL:', videoUrl);
                console.log('Thumbnail URL:', thumbnailUrl);
                
            } catch (storageError) {
                console.error('Storage error details:', storageError);
                console.error('Error code:', storageError.code);
                console.error('Error message:', storageError.message);
                
                // Try alternative path structure
                try {
                    console.log('Trying alternative path structure...');
                    const videoRef = firebase.storage().ref(`notebooks/${this.currentUser.uid}/recordings/video_${this.recordingId}.webm`);
                    const thumbnailRef = firebase.storage().ref(`notebooks/${this.currentUser.uid}/recordings/thumb_${this.recordingId}.png`);
                    
                    console.log('Alternative video path:', videoRef.fullPath);
                    console.log('Alternative thumbnail path:', thumbnailRef.fullPath);
                    
                    const [videoSnapshot, thumbnailSnapshot] = await Promise.all([
                        videoRef.put(this.recordedVideoBlob),
                        thumbnailRef.put(thumbnailBlob)
                    ]);
                    
                    videoUrl = await videoSnapshot.ref.getDownloadURL();
                    thumbnailUrl = await thumbnailSnapshot.ref.getDownloadURL();
                    storagePath = 'notebooks_recordings';
                    
                    console.log('Successfully saved to alternative notebooks path');
                    
                } catch (alternativeError) {
                    console.error('Alternative path also failed:', alternativeError);
                    throw new Error(`Storage failed. Tried paths: notebooks/${this.currentUser.uid}/ and notebooks/${this.currentUser.uid}/recordings/. Error: ${storageError.message}`);
                }
            }

            // Get canvas data
            const canvasData = this.canvas.toDataURL('image/png');

            // Save metadata to Firestore
            const recordingData = {
                userId: this.currentUser.uid,
                title: title,
                description: description || '',
                duration: this._maxSeconds,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                accessLevel: 'public', // Default to public read
                videoUrl: videoUrl,
                thumbnailUrl: thumbnailUrl,
                canvasData: canvasData,
                notebookId: notebookId || null,
                createdAt: new Date(),
                // Add public access information
                isPublic: true,
                publicReadUrl: videoUrl, // Direct access URL
                publicThumbnailUrl: thumbnailUrl
            };

            try {
                await firebase.firestore().collection('recordings').doc(this.recordingId).set(recordingData);
                console.log('Metadata saved to Firestore successfully');
            } catch (firestoreError) {
                console.error('Firestore error:', firestoreError);
                // Continue with success since files were saved to Storage
                console.log('Files saved to Storage, but metadata save failed. This may be due to missing Firestore rules.');
            }

            // Store URLs for easy access
            this.lastVideoUrl = videoUrl;
            this.lastThumbnailUrl = thumbnailUrl;
            this.lastRecordingTitle = title;
            this.lastRecordingId = this.recordingId;
            
            // Store globally for notebook access
            window.lastRecordingVideoUrl = videoUrl;
            window.lastRecordingThumbnailUrl = thumbnailUrl;
            window.lastRecordingTitle = title;
            window.lastRecordingId = this.recordingId;
            
            // Update video element with final URLs and metadata
            if (this.videoPlayer) {
                this.videoPlayer.setAttribute('data-video-url', videoUrl);
                this.videoPlayer.setAttribute('data-thumbnail-url', thumbnailUrl);
                this.videoPlayer.setAttribute('data-recording-title', title);
                this.videoPlayer.setAttribute('data-firebase-urls', 'true');
            }
            
            // Dispatch custom event for notebook integration
            const saveEvent = new CustomEvent('recordingSaved', {
                detail: {
                    videoUrl: videoUrl,
                    thumbnailUrl: thumbnailUrl,
                    title: title,
                    recordingId: this.recordingId,
                    userId: this.currentUser.uid
                }
            });
            this.dispatchEvent(saveEvent);
            
            // Show success message with copy options
            const successMessage = `Recording saved successfully!\n\nVideo URL: ${videoUrl}\nThumbnail URL: ${thumbnailUrl}\n\nThese URLs are now available:\n- In the component (recorder.lastVideoUrl)\n- Globally (window.lastRecordingVideoUrl)\n- Via 'recordingSaved' event`;
            alert(successMessage);
            
            // Update UI
            this.querySelector('#postRecordingButtons').style.display = 'none';

        } catch (error) {
            console.error('Save error:', error);
            
            // Provide more helpful error messages
            if (error.message.includes('storage/unauthorized')) {
                throw new Error('Storage permission denied. Please check Firebase Storage rules or contact administrator.');
            } else if (error.message.includes('storage/quota-exceeded')) {
                throw new Error('Storage quota exceeded. Please try a shorter recording.');
            } else if (error.message.includes('firestore/permission-denied')) {
                throw new Error('Database permission denied. Please check Firestore rules.');
            } else {
                throw new Error('Failed to save recording: ' + error.message);
            }
        }
    }

    async createThumbnail() {
        // Create a canvas for thumbnail
        const thumbnailCanvas = document.createElement('canvas');
        const thumbnailCtx = thumbnailCanvas.getContext('2d');
        
        // Set thumbnail size
        thumbnailCanvas.width = 320;
        thumbnailCanvas.height = 240;
        
        // Draw the main canvas content scaled down
        thumbnailCtx.drawImage(this.canvas, 0, 0, 320, 240);
        
        // Convert to blob
        return new Promise(resolve => {
            thumbnailCanvas.toBlob(resolve, 'image/png');
        });
    }

    // Static method to get public recordings (can be called without authentication)
    static async getPublicRecordings(limit = 10) {
        try {
            const recordingsRef = firebase.firestore().collection('recordings');
            const query = recordingsRef.where('isPublic', '==', true).orderBy('timestamp', 'desc').limit(limit);
            const snapshot = await query.get();
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error fetching public recordings:', error);
            return [];
        }
    }

    // Static method to get a specific public recording
    static async getPublicRecording(recordingId) {
        try {
            const doc = await firebase.firestore().collection('recordings').doc(recordingId).get();
            if (doc.exists && doc.data().isPublic) {
                return {
                    id: doc.id,
                    ...doc.data()
                };
            }
            return null;
        } catch (error) {
            console.error('Error fetching public recording:', error);
            return null;
        }
    }
    
    // Helper method to get all recording data from video element
    static getRecordingDataFromVideo(videoElement) {
        if (!videoElement || !videoElement.hasAttribute('data-firebase-urls')) {
            return null;
        }
        
        return {
            recordingId: videoElement.getAttribute('data-recording-id'),
            title: videoElement.getAttribute('data-recording-title'),
            timestamp: videoElement.getAttribute('data-recording-timestamp'),
            userId: videoElement.getAttribute('data-user-id'),
            videoUrl: videoElement.getAttribute('data-video-url'),
            thumbnailUrl: videoElement.getAttribute('data-thumbnail-url'),
            element: videoElement
        };
    }
}

// Register the drawcast component
console.log('Registering ui-drawcast component');
customElements.define('ui-drawcast', UIDrawcast);
console.log('ui-drawcast component registered');

// Helper function to create drawcast elements
function createDrawcastElement(options = {}) {
    const element = document.createElement('ui-drawcast');
    
    // Set attributes from options
    if (options.maxSeconds) element.maxSeconds = options.maxSeconds;
    if (options.recordAudio !== undefined) element.recordAudio = options.recordAudio;
    if (options.recordCamera !== undefined) element.recordCamera = options.recordCamera;
    if (options.recordCanvas !== undefined) element.recordCanvas = options.recordCanvas;
    if (options.canvasWidth) element.canvasWidth = options.canvasWidth;
    if (options.canvasHeight) element.canvasHeight = options.canvasHeight;
    if (options.backgroundColor) element.backgroundColor = options.backgroundColor;
    
    return element;
}

// Add info about storage path
console.log('UI Drawcast: Recordings will be saved to notebooks/{userId}/recordings/ path');

// Make createDrawcastElement globally available
if (typeof window !== 'undefined') {
    window.createDrawcastElement = createDrawcastElement;
    
    // Add helper functions for public access
    window.getPublicRecordings = UIDrawcast.getPublicRecordings;
    window.getPublicRecording = UIDrawcast.getPublicRecording;
}

// Test component creation
console.log('Testing drawcast component creation...');
try {
    const testDrawcast = document.createElement('ui-drawcast');
    console.log('Drawcast created successfully:', testDrawcast);
} catch (error) {
    console.error('Error creating drawcast component:', error);
}


