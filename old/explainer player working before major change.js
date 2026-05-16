/**
 * ExplainerPlayer Web Component
 * A comprehensive animation and drawing web component based on the Python explainer versions
 * Supports SVG drawing, speech, math, markdown, questions, and more
 */

// External dependencies (loaded via CDN)
const ROUGH_JS_URL = 'https://unpkg.com/roughjs@latest/bundled/rough.js';
const ROUGH_NOTATION_URL = 'https://unpkg.com/rough-notation/lib/rough-notation.iife.js';
const MATHJAX_URL = 'https://polyfill.io/v3/polyfill.min.js?features=es6';
const MATHJAX_CONFIG = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';

class ExplainerPlayer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.commands = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.showSubtitles = false;
    this.questionStats = {
      per_question: {},
      total_tries: 0,
      total_corrects: 0,
      total_correct_on_first_try: 0,
      total_time_on_questions: 0.0
    };
    this.groups = {};
    this.zoomGroup = null;
    this.currentZoomFactor = 1.0;
    this.currentUtterance = null;
    this.speakingCanceled = false;
    this.autoIdCounter = 0;
    this.currentY = 380; // Starting Y position for auto-positioning
    this.lineSize = 20;
    this.tabSize = 20;
    this.xMargin = 20;
    this.yMargin = 10;
  }

  // Convert mathematical coordinates (0,0 = lower left) to SVG coordinates (0,0 = upper left)
  cartesianToSvgY(y) {
    return parseFloat(this.height) - parseFloat(y);
  }

  static get observedAttributes() {
    return ['width', 'height', 'commands', 'svg-coordinates'];
  }

  get width() { return this.getAttribute('width') || '600'; }
  get height() { return this.getAttribute('height') || '400'; }
  get svgCoordinates() { 
    const attr = this.getAttribute('svg-coordinates');
    return attr === null ? true : attr === 'true';
  }

  connectedCallback() {
    console.log('ExplainerPlayer connected');
    this.init();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'commands' && newValue) {
      this.parseCommands();
    }
  }

  async init() {
    await this.loadDependencies();
    this.createStyles();
    this.createHTML();
    this.setupEventListeners();
    
    // Wait for the next tick to ensure HTML is fully rendered
    await new Promise(resolve => setTimeout(resolve, 0));
    this.parseCommands();
  }

  async loadDependencies() {
    // Load external dependencies
    const loadScript = (src) => new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    try {
      await Promise.all([
        loadScript(ROUGH_JS_URL),
        loadScript(ROUGH_NOTATION_URL),
        loadScript(MATHJAX_URL),
        loadScript(MATHJAX_CONFIG)
      ]);
    } catch (error) {
      console.warn('Some dependencies failed to load:', error);
    }
  }

  createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css?family=Patrick+Hand|Patrick+Hand+SC');
      
      :host {
        display: block;
        font-family: 'Patrick Hand', cursive;
      }
      
      .explainer-container {
        position: relative;
        width: ${this.width}px;
        height: ${this.height}px;
        border: 2px solid black;
        border-radius: 12px;
        background: white;
        overflow: hidden;
      }
      
      .explainer-svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      
      .explainer-svg text {
        font-family: 'Patrick Hand', cursive;
      }
      
      .controls {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(236, 236, 236, 0.95);
        border-top: 1px solid #999;
        padding: 5px;
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        border-radius: 0 0 12px 12px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      .controls.visible {
        opacity: 1;
      }
      
      .controls button {
        background: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
      }
      
      .controls button:hover {
        background: #e0e0e0;
      }
      
      .progress-slider {
        flex: 1;
        min-width: 100px;
      }
      
      .subtitles {
        position: absolute;
        bottom: 50px;
        left: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 8px;
        border-radius: 4px;
        font-size: 14px;
        max-height: 100px;
        overflow-y: auto;
        display: none;
      }
      
      .question-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      
      .question-box {
        background: white;
        border: 2px solid black;
        border-radius: 10px;
        padding: 20px;
        max-width: 400px;
        max-height: 300px;
        overflow-y: auto;
        font-family: inherit;
      }
      
      .question-text {
        margin-bottom: 15px;
        font-weight: bold;
      }
      
      .question-option {
        border: 1px solid #ccc;
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .question-option:hover {
        background: #f0f0f0;
      }
      
      .question-feedback {
        text-align: center;
        margin-top: 15px;
        font-weight: bold;
      }
      
      .pointer-circle {
        fill: yellow;
        opacity: 0.5;
        animation: pulse 1s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.8; }
      }
      
      .highlighted {
        stroke-width: 4px !important;
        animation: highlight-pulse 0.5s ease-in-out;
      }
      
      @keyframes highlight-pulse {
        0%, 100% { stroke-width: 4px; }
        50% { stroke-width: 6px; }
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  createHTML() {
    const container = document.createElement('div');
    container.className = 'explainer-container';
    
    // SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'explainer-svg');
    svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.id = 'explainer-svg';
    
    // Controls
    const controls = document.createElement('div');
    controls.className = 'controls';
    
    const playPauseBtn = document.createElement('button');
    playPauseBtn.textContent = '▶/⏸';
    playPauseBtn.id = 'play-pause';
    
    const rewindBtn = document.createElement('button');
    rewindBtn.textContent = '⏮';
    rewindBtn.id = 'rewind';
    
    const subtitlesBtn = document.createElement('button');
    subtitlesBtn.textContent = '🄪';
    subtitlesBtn.id = 'subtitles-toggle';
    
    const progressSlider = document.createElement('input');
    progressSlider.type = 'range';
    progressSlider.className = 'progress-slider';
    progressSlider.min = '0';
    progressSlider.max = '0';
    progressSlider.value = '0';
    progressSlider.id = 'progress-slider';
    
    controls.appendChild(playPauseBtn);
    controls.appendChild(rewindBtn);
    controls.appendChild(subtitlesBtn);
    controls.appendChild(progressSlider);
    
    // Subtitles
    const subtitles = document.createElement('div');
    subtitles.className = 'subtitles';
    subtitles.id = 'subtitles';
    
    container.appendChild(svg);
    container.appendChild(controls);
    container.appendChild(subtitles);
    
    this.shadowRoot.appendChild(container);
    
    // Store references
    this.svg = svg;
    this.controls = controls;
    this.subtitles = subtitles;
  }

  setupEventListeners() {
    // Mouse events for showing/hiding controls
    this.addEventListener('mousemove', (e) => {
      const rect = this.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const nearBottom = y >= rect.height - 50;
      
      if (nearBottom || this.isPaused) {
        this.controls.classList.add('visible');
      } else {
        this.controls.classList.remove('visible');
      }
    });

    this.addEventListener('mouseleave', () => {
      if (!this.isPaused) {
        this.controls.classList.remove('visible');
      }
    });

    // Control button events
    this.shadowRoot.getElementById('play-pause').addEventListener('click', () => this.togglePlay());
    this.shadowRoot.getElementById('rewind').addEventListener('click', () => this.rewind());
    this.shadowRoot.getElementById('subtitles-toggle').addEventListener('click', () => this.toggleSubtitles());
    
    // Progress slider events
    const slider = this.shadowRoot.getElementById('progress-slider');
    slider.addEventListener('input', (e) => this.onSliderInput(e));
    slider.addEventListener('change', (e) => this.onSliderChange(e));
  }

  parseCommands() {
    const commandsAttr = this.getAttribute('commands');
    if (commandsAttr) {
      try {
        this.commands = JSON.parse(commandsAttr);
        const slider = this.shadowRoot.getElementById('progress-slider');
        if (slider) {
          slider.max = this.commands.length;
        }
        console.log('Parsed commands:', this.commands);
      } catch (error) {
        console.error('Failed to parse commands:', error);
        this.commands = [];
      }
    } else {
      this.commands = [];
    }
  }

  // Animation and easing functions
  ease(progress, easingType) {
    switch (easingType) {
      case 'ease-in': return progress ** 2;
      case 'ease-out': return 1 - (1 - progress) ** 2;
      case 'ease-in-out': 
        return progress < 0.5 ? 2 * (progress ** 2) : 1 - 2 * ((1 - progress) ** 2);
      default: return progress;
    }
  }

  async animateDraw(element, duration = 0, easing = 'linear') {
    if (duration <= 0) return;
    
    const start = performance.now();
    let length = null;
    
    try {
      length = element.getTotalLength();
    } catch (e) {
      length = null;
    }
    
    if (length !== null) {
      element.setAttribute('stroke-dasharray', length);
      element.setAttribute('stroke-dashoffset', length);
    } else {
      element.style.opacity = '0';
    }
    
    return new Promise((resolve) => {
      const animate = (currentTime) => {
        const elapsed = currentTime - start;
        const rawProgress = Math.min(1, elapsed / (duration * 1000));
        const easedProgress = this.ease(rawProgress, easing);
        
        if (length !== null) {
          const offset = length * (1 - easedProgress);
          element.setAttribute('stroke-dashoffset', offset);
        } else {
          element.style.opacity = easedProgress;
        }
        
        if (rawProgress >= 1) {
          if (length !== null) {
            element.removeAttribute('stroke-dasharray');
            element.removeAttribute('stroke-dashoffset');
          }
          resolve();
        } else {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    });
  }

  async animateMove(element, x, y, duration = 1, easing = 'linear') {
    const start = performance.now();
    const initX = parseFloat(element.getAttribute('x') || 0);
    const initY = parseFloat(element.getAttribute('y') || 0);
    
    return new Promise((resolve) => {
      const animate = (currentTime) => {
        const elapsed = currentTime - start;
        const rawProgress = Math.min(1, elapsed / (duration * 1000));
        const easedProgress = this.ease(rawProgress, easing);
        
        const newX = initX + easedProgress * (x - initX);
        const newY = initY + easedProgress * (y - initY);
        
        element.setAttribute('x', newX);
        element.setAttribute('y', newY);
        
        if (rawProgress >= 1) {
          resolve();
        } else {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    });
  }

  // Speech synthesis
  async speakText(details) {
    const text = details.text || '';
    if (!text) return;
    
    // Cancel any ongoing speech
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    
    this.speakingCanceled = false;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = details.lang || 'en-US';
    utterance.pitch = parseFloat(details.pitch || 1);
    utterance.rate = parseFloat(details.rate || 1);
    utterance.volume = parseFloat(details.volume || 1);
    
    // Voice selection - prioritize English voices
    const voices = window.speechSynthesis.getVoices();
    const male = details.male !== false;
    const voiceName = details.voice;
    
    let chosenVoice = null;
    if (voiceName) {
      chosenVoice = voices.find(v => v.name === voiceName);
    } else {
      // First try to find English voices
      chosenVoice = voices.find(v => 
        v.lang && (v.lang.startsWith('en-US') || v.lang.startsWith('en-GB')) && 
        (male ? v.name.toLowerCase().includes('male') : !v.name.toLowerCase().includes('male'))
      );
      
      // If no English voice found, try any English language
      if (!chosenVoice) {
        chosenVoice = voices.find(v => 
          v.lang && v.lang.startsWith('en') && 
          (male ? v.name.toLowerCase().includes('male') : !v.name.toLowerCase().includes('male'))
        );
      }
      
      // Fallback to any voice
      if (!chosenVoice) {
        chosenVoice = voices[0];
      }
    }
    
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }
    
    this.currentUtterance = utterance;
    
    // Show subtitles if enabled
    if (this.showSubtitles && this.subtitles) {
      this.subtitles.textContent = text;
      this.subtitles.style.display = 'block';
    }
    
    return new Promise((resolve) => {
      utterance.onend = () => {
        this.currentUtterance = null;
        if (this.subtitles) {
          this.subtitles.style.display = 'none';
        }
        resolve();
      };
      
      utterance.onerror = () => {
        this.currentUtterance = null;
        if (this.subtitles) {
          this.subtitles.style.display = 'none';
        }
        resolve();
      };
      
      window.speechSynthesis.speak(utterance);
    });
  }

  // SVG command execution
  async executeSvgCommand(cmd) {
    const command = cmd.command?.toLowerCase();
    const duration = parseFloat(cmd.duration || 0);
    const easing = cmd.easing || 'linear';
    
    // Handle special commands
    if (command === 'clear') {
      this.svg.innerHTML = '';
      this.groups = {};
      this.zoomGroup = null;
      this.currentZoomFactor = 1.0;
      this.currentY = parseFloat(this.height) - this.yMargin;
      return;
    }
    
    if (command === 'new_page') {
      const scrollUp = cmd.scroll_up;
      const title = cmd.title;
      
      if (scrollUp) {
        // Animate existing content upward
        const tempGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        while (this.svg.firstChild) {
          tempGroup.appendChild(this.svg.firstChild);
        }
        this.svg.appendChild(tempGroup);
        
        const animDuration = duration > 0 ? duration : 1;
        const offset = parseFloat(this.height);
        
        await this.animateMove(tempGroup, 0, -offset, animDuration, easing);
      }
      
      // Clear and reset
      this.svg.innerHTML = '';
      this.groups = {};
      this.zoomGroup = null;
      this.currentZoomFactor = 1.0;
      this.currentY = parseFloat(this.height) - this.yMargin;
      
      // Add title if provided
      if (title) {
        const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleText.setAttribute('x', parseFloat(this.width) / 2);
        titleText.setAttribute('y', '30');
        titleText.setAttribute('text-anchor', 'middle');
        titleText.style.fontSize = '24px';
        titleText.style.fontFamily = 'Patrick Hand, cursive';
        titleText.style.fill = 'black';
        titleText.textContent = title;
        this.svg.appendChild(titleText);
        this.currentY -= 35;
      }
      
      return;
    }
    
    if (command === 'move') {
      const element = this.svg.querySelector(`#${cmd.id}`);
      if (element) {
        const x = parseFloat(cmd.x || 0);
        const y = this.cartesianToSvgY(parseFloat(cmd.y || 0));
        await this.animateMove(element, x, y, duration, easing);
      }
      return;
    }
    
    if (command === 'set_attribute') {
      const element = this.svg.querySelector(`#${cmd.id}`);
      if (element && cmd.attr && cmd.value !== undefined) {
        element.setAttribute(cmd.attr, cmd.value);
      }
      return;
    }
    
    if (command === 'zoom') {
      await this.handleZoom(cmd);
      return;
    }
    
    if (command === 'markdown') {
      await this.handleMarkdown(cmd);
      return;
    }
    
    if (command === 'math') {
      await this.handleMath(cmd);
      return;
    }
    
    if (command === 'pointer') {
      await this.handlePointer(cmd);
      return;
    }
    
    if (command === 'highlight') {
      await this.handleHighlight(cmd);
      return;
    }
    
    // Regular SVG element creation
    const element = document.createElementNS('http://www.w3.org/2000/svg', command || 'g');
    
    // Auto-generate ID if not provided
    if (!cmd.id) {
      element.id = `auto_${++this.autoIdCounter}`;
    } else {
      element.id = cmd.id;
    }
    
    // Set default styles
    element.style.fontFamily = cmd['font-family'] || 'Patrick Hand, cursive';
    element.style.fontSize = cmd['font-size'] || '14px';
    element.style.fill = cmd.fill || 'black';
    element.setAttribute('xml:space', 'preserve');
    
    // Set attributes
    for (const [key, value] of Object.entries(cmd)) {
      if (['action', 'command', 'duration', 'easing', 'group', 'font-family', 'font-size', 'fill', 'scroll_up', 'title'].includes(key)) {
        continue;
      }
      
      if (key.toLowerCase().startsWith('y') && ['y', 'y1', 'y2'].includes(key)) {
        // Only transform coordinates if not using SVG coordinate system
        const yValue = this.svgCoordinates ? value : this.cartesianToSvgY(value);
        element.setAttribute(key, yValue);
      } else {
        element.setAttribute(key, value);
      }
    }
    
    // Handle text content
    if (command === 'text' && cmd.text) {
      let x = parseFloat(cmd.x || this.xMargin);
      let y = cmd.y !== undefined ? 
        (this.svgCoordinates ? parseFloat(cmd.y) : this.cartesianToSvgY(parseFloat(cmd.y))) : 
        (this.svgCoordinates ? this.currentY - this.lineSize : this.cartesianToSvgY(this.currentY - this.lineSize));
      
      // Handle auto-positioning
      if (cmd.y === undefined) {
        if (y < 10) {
          await this.scrollArea();
          y = this.cartesianToSvgY(parseFloat(this.height) / 2 - this.lineSize);
          this.currentY = parseFloat(this.height) / 2;
        }
        this.currentY -= this.lineSize;
      }
      
      element.setAttribute('x', x);
      element.setAttribute('y', y);
      
      // Handle line breaks
      const text = cmd.text;
      if (text.includes('\n')) {
        const lines = text.split('\n');
        element.textContent = '';
        
        for (let i = 0; i < lines.length; i++) {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', x);
          if (i > 0) {
            tspan.setAttribute('dy', '1.2em');
          }
          element.appendChild(tspan);
          
          // Animate character by character
          if (duration > 0) {
            const charDelay = duration / text.length;
            for (const char of lines[i]) {
              tspan.textContent += char;
              await this.sleep(charDelay * 1000);
            }
          } else {
            tspan.textContent = lines[i];
          }
        }
      } else {
        // Animate character by character
        if (duration > 0) {
          const charDelay = duration / text.length;
          for (const char of text) {
            element.textContent += char;
            await this.sleep(charDelay * 1000);
          }
        } else {
          element.textContent = text;
        }
      }
    }
    
    // Add to SVG
    this.svg.appendChild(element);
    
    // Animate if duration > 0
    if (duration > 0) {
      await this.animateDraw(element, duration, easing);
    }
  }

  // Special command handlers
  async handleMarkdown(cmd) {
    const x = parseFloat(cmd.x || this.xMargin);
    let y = cmd.y !== undefined ? 
      (this.svgCoordinates ? parseFloat(cmd.y) : this.cartesianToSvgY(parseFloat(cmd.y))) : 
      (this.svgCoordinates ? this.currentY - this.lineSize : this.cartesianToSvgY(this.currentY - this.lineSize));
    
    if (cmd.y === undefined) {
      if (y < 10) {
        await this.scrollArea();
        y = this.cartesianToSvgY(parseFloat(this.height) / 2 - this.lineSize);
        this.currentY = parseFloat(this.height) / 2;
      }
      this.currentY -= this.lineSize;
    }
    
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreignObject.setAttribute('x', x);
    foreignObject.setAttribute('y', y);
    foreignObject.setAttribute('width', '300');
    foreignObject.setAttribute('height', '10');
    
    const div = document.createElement('div');
    div.style.fontSize = cmd['font-size'] || '14px';
    div.style.color = cmd.fill || 'black';
    div.style.display = 'inline-block';
    div.style.visibility = 'hidden';
    
    // Simple markdown rendering (you can enhance this)
    const text = cmd.text || '';
    div.innerHTML = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    
    foreignObject.appendChild(div);
    this.svg.appendChild(foreignObject);
    
    // Wait for rendering and measure
    await this.sleep(50);
    const width = div.scrollWidth;
    const height = div.scrollHeight;
    foreignObject.setAttribute('width', width);
    foreignObject.setAttribute('height', height);
    div.style.visibility = 'visible';
    
    if (cmd.y === undefined) {
      this.currentY -= height;
    }
  }

  async handleMath(cmd) {
    const x = parseFloat(cmd.x || this.xMargin);
    let y = cmd.y !== undefined ? 
      (this.svgCoordinates ? parseFloat(cmd.y) : this.cartesianToSvgY(parseFloat(cmd.y))) : 
      (this.svgCoordinates ? this.currentY - this.lineSize : this.cartesianToSvgY(this.currentY - this.lineSize));
    
    if (cmd.y === undefined) {
      if (y < 10) {
        await this.scrollArea();
        y = this.cartesianToSvgY(parseFloat(this.height) / 2 - this.lineSize);
        this.currentY = parseFloat(this.height) / 2;
      }
      this.currentY -= this.lineSize;
    }
    
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreignObject.setAttribute('x', x);
    foreignObject.setAttribute('y', y);
    foreignObject.setAttribute('width', '300');
    foreignObject.setAttribute('height', '50');
    foreignObject.style.opacity = '0';
    
    const div = document.createElement('div');
    div.style.fontSize = cmd['font-size'] || '16px';
    div.style.color = cmd.fill || 'darkred';
    div.style.display = 'inline-block';
    
    let mathText = (cmd.text || '').trim();
    const ascii = cmd.ascii !== false;
    const isAscii = ascii || (mathText.startsWith('@') && mathText.endsWith('@'));
    
    if (isAscii) {
      if (!mathText.startsWith('@')) {
        mathText = '@' + mathText + '@';
      }
      div.innerHTML = mathText;
    } else {
      if (!mathText.startsWith('$$')) {
        mathText = '$$' + mathText + '$$';
      }
      div.innerHTML = mathText;
    }
    
    foreignObject.appendChild(div);
    this.svg.appendChild(foreignObject);
    
    // Typeset with MathJax if available
    if (window.MathJax && window.MathJax.typeset) {
      window.MathJax.typeset([div]);
    }
    
    await this.sleep(100);
    
    const width = div.scrollWidth;
    const height = div.scrollHeight;
    foreignObject.setAttribute('width', width);
    foreignObject.setAttribute('height', height);
    
    if (cmd.y === undefined) {
      this.currentY -= height;
    }
    
    foreignObject.style.transition = 'opacity 0.2s ease-in-out';
    foreignObject.style.opacity = '1';
  }

  async handlePointer(cmd) {
    const x = parseFloat(cmd.x || 0);
    const y = this.svgCoordinates ? parseFloat(cmd.y || 0) : this.cartesianToSvgY(parseFloat(cmd.y || 0));
    const r = parseFloat(cmd.r || 5);
    const duration = parseFloat(cmd.duration || 1);
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    circle.className = 'pointer-circle';
    
    this.svg.appendChild(circle);
    
    await this.sleep(duration * 1000);
    circle.remove();
  }

  async handleHighlight(cmd) {
    const element = this.svg.querySelector(`#${cmd.id}`);
    if (!element) return;
    
    const color = cmd.color || '#ff0';
    const duration = parseFloat(cmd.duration || 1);
    
    const oldStroke = element.getAttribute('stroke');
    const oldStrokeWidth = element.getAttribute('stroke-width');
    
    element.setAttribute('stroke', color);
    element.setAttribute('stroke-width', '4');
    element.classList.add('highlighted');
    
    await this.sleep(duration * 1000);
    
    if (oldStroke) {
      element.setAttribute('stroke', oldStroke);
    } else {
      element.removeAttribute('stroke');
    }
    
    if (oldStrokeWidth) {
      element.setAttribute('stroke-width', oldStrokeWidth);
    } else {
      element.removeAttribute('stroke-width');
    }
    
    element.classList.remove('highlighted');
  }

  async handleZoom(cmd) {
    const reset = cmd.reset || false;
    const level = parseFloat(cmd.level || 1.0);
    
    if (!this.zoomGroup) {
      this.zoomGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.zoomGroup.id = 'zoom-container';
      
      const children = Array.from(this.svg.children);
      children.forEach(child => this.zoomGroup.appendChild(child));
      this.svg.appendChild(this.zoomGroup);
    }
    
    if (reset || Math.abs(level - 1.0) < 1e-9) {
      this.currentZoomFactor = 1.0;
      this.zoomGroup.setAttribute('transform', '');
      return;
    }
    
    this.currentZoomFactor = level;
    
    const elementId = cmd.id;
    if (elementId) {
      const target = this.svg.querySelector(`#${elementId}`);
      if (target) {
        const tx = parseFloat(target.getAttribute('x') || 0);
        const ty = this.cartesianToSvgY(parseFloat(target.getAttribute('y') || 0));
        const transform = `translate(${tx},${ty}) scale(${level}) translate(${-tx},${-ty})`;
        this.zoomGroup.setAttribute('transform', transform);
        return;
      }
    }
    
    const zx = parseFloat(cmd.x || 0);
    const zy = this.cartesianToSvgY(parseFloat(cmd.y || 0));
    const transform = `translate(${zx},${zy}) scale(${level}) translate(${-zx},${-zy})`;
    this.zoomGroup.setAttribute('transform', transform);
  }

  async handleQuestion(cmd) {
    const question = cmd.question || '(No question)';
    const alternatives = cmd.alternatives || [];
    const correctIdx = cmd.answer || 0;
    
    const overlay = document.createElement('div');
    overlay.className = 'question-overlay';
    overlay.id = `question_${Date.now()}`;
    
    const box = document.createElement('div');
    box.className = 'question-box';
    
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-text';
    questionDiv.textContent = question;
    box.appendChild(questionDiv);
    
    const answersDiv = document.createElement('div');
    
    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = 'question-feedback';
    feedbackDiv.style.color = 'blue';
    feedbackDiv.style.fontWeight = 'bold';
    
    const startTime = performance.now();
    let tries = 0;
    let correct = false;
    let correctOnFirstTry = false;
    
    alternatives.forEach((alt, idx) => {
      const option = document.createElement('div');
      option.className = 'question-option';
      option.textContent = alt;
      option.addEventListener('click', () => {
        tries++;
        this.questionStats.total_tries++;
        
        if (idx === correctIdx) {
          correct = true;
          this.questionStats.total_corrects++;
          if (tries === 1) {
            correctOnFirstTry = true;
            this.questionStats.total_correct_on_first_try++;
          }
          
          feedbackDiv.textContent = 'Correct!';
          feedbackDiv.style.color = 'green';
          
          const endTime = performance.now();
          const timeSpent = (endTime - startTime) / 1000;
          this.questionStats.total_time_on_questions += timeSpent;
          
          setTimeout(() => {
            overlay.remove();
          }, 800);
        } else {
          feedbackDiv.textContent = 'Try again!';
          feedbackDiv.style.color = 'red';
        }
      });
      answersDiv.appendChild(option);
    });
    
    box.appendChild(answersDiv);
    box.appendChild(feedbackDiv);
    overlay.appendChild(box);
    
    this.shadowRoot.appendChild(overlay);
    
    // Wait for question to be answered
    return new Promise((resolve) => {
      const checkRemoved = () => {
        if (!document.contains(overlay)) {
          resolve();
        } else {
          setTimeout(checkRemoved, 100);
        }
      };
      checkRemoved();
    });
  }

  async scrollArea() {
    // Simple scroll implementation - move all content up
    const children = Array.from(this.svg.children);
    const tempGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    children.forEach(child => tempGroup.appendChild(child));
    this.svg.appendChild(tempGroup);
    
    const offset = parseFloat(this.height);
    await this.animateMove(tempGroup, 0, -offset, 0.5);
    
    // Clear and reset
    this.svg.innerHTML = '';
    this.currentY = parseFloat(this.height) / 2;
  }

  // Utility functions

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Control methods
  async togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  onSliderInput(e) {
    if (this.isPlaying) {
      this.pause();
    }
    const value = parseInt(e.target.value);
    this.currentIndex = value;
    this.fastRedraw(value);
  }

  onSliderChange(e) {
    const value = parseInt(e.target.value);
    this.currentIndex = value;
    this.fastRedraw(value);
  }

  fastRedraw(index) {
    // Clear screen
    this.svg.innerHTML = '';
    if (this.subtitles) {
      this.subtitles.style.display = 'none';
    }
    this.groups = {};
    this.zoomGroup = null;
    this.currentZoomFactor = 1.0;
    this.currentY = parseFloat(this.height) - this.yMargin;
    
    // Re-apply commands up to index (without duration)
    for (let i = 0; i < index; i++) {
      const cmd = this.commands[i];
      const action = cmd.action?.toLowerCase();
      
      if (action === 'svg') {
        const localCmd = { ...cmd, duration: 0 };
        this.executeSvgCommand(localCmd);
      } else if (action?.startsWith('speak_and_')) {
        if (cmd.draw) {
          const localCmd = { ...cmd.draw, duration: 0 };
          this.executeSvgCommand(localCmd);
        } else if (cmd.move) {
          const moveCmd = { ...cmd.move, command: 'move', duration: 0 };
          this.executeSvgCommand(moveCmd);
        }
      } else if (action === 'math') {
        this.handleMath(cmd);
      } else if (action === 'markdown') {
        this.handleMarkdown(cmd);
      } else if (action === 'zoom') {
        this.handleZoom(cmd);
      }
    }
  }

  async playFromCurrent() {
    console.log('Starting playFromCurrent, commands:', this.commands.length, 'currentIndex:', this.currentIndex);
    while (this.currentIndex < this.commands.length && this.isPlaying) {
      const cmd = this.commands[this.currentIndex];
      const action = cmd.action?.toLowerCase();
      console.log('Executing command:', cmd, 'action:', action);
      
      try {
        if (action === 'svg') {
          await this.executeSvgCommand(cmd);
        } else if (action === 'speak') {
          await this.speakText(cmd);
        } else if (action === 'pause') {
          await this.sleep((cmd.seconds || 1) * 1000);
        } else if (action === 'delete') {
          const element = this.svg.querySelector(`#${cmd.id}`);
          if (element) element.remove();
        } else if (action === 'question') {
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
          await this.handleQuestion(cmd);
        } else if (action === 'audio') {
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
          // Audio playback implementation
          if (cmd.src) {
            const audio = new Audio(cmd.src);
            audio.play();
            await new Promise(resolve => {
              audio.onended = resolve;
              audio.onerror = resolve;
            });
          }
        } else if (action === 'math') {
          await this.handleMath(cmd);
        } else if (action === 'markdown') {
          await this.handleMarkdown(cmd);
        } else if (action === 'pointer') {
          await this.handlePointer(cmd);
        } else if (action === 'highlight') {
          await this.handleHighlight(cmd);
        } else if (action === 'zoom') {
          await this.handleZoom(cmd);
        } else if (action === 'speak_and_draw') {
          this.speakText(cmd.speak || {});
          await this.executeSvgCommand(cmd.draw || {});
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'speak_and_move') {
          this.speakText(cmd.speak || {});
          const moveCmd = { ...cmd.move, command: 'move' };
          await this.executeSvgCommand(moveCmd);
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'speak_and_highlight') {
          this.speakText(cmd.speak || {});
          await this.handleHighlight(cmd.highlight || {});
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'speak_and_point') {
          this.speakText(cmd.speak || {});
          await this.handlePointer(cmd.pointer || {});
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        } else if (action === 'finish_speaking') {
          while (window.speechSynthesis.speaking) {
            await this.sleep(100);
          }
        }
      } catch (error) {
        console.error('Error executing command:', cmd, error);
      }
      
      this.currentIndex++;
      this.shadowRoot.getElementById('progress-slider').value = this.currentIndex;
      
      if (this.currentIndex >= this.commands.length) {
        break;
      }
      
      await this.sleep(40);
    }
    
    this.isPlaying = false;
    console.log('Done playing!');
    console.log('Question Stats:', this.questionStats);
  }

  // Public API methods
  setCommands(commands) {
    this.commands = commands;
    const slider = this.shadowRoot?.getElementById('progress-slider');
    if (slider) {
      slider.max = commands.length;
    }
    this.currentIndex = 0;
    this.fastRedraw(0);
  }

  getCommands() {
    return this.commands;
  }

  getQuestionStats() {
    return this.questionStats;
  }

  // Expose control methods as public API
  play() {
    if (!this.shadowRoot) {
      console.warn('ExplainerPlayer not fully initialized yet');
      return;
    }
    
    this.isPlaying = true;
    this.isPaused = false;
    if (this.controls) {
      this.controls.classList.add('visible');
    }
    this.playFromCurrent();
  }

  pause() {
    if (!this.shadowRoot) {
      console.warn('ExplainerPlayer not fully initialized yet');
      return;
    }
    
    this.isPlaying = false;
    this.isPaused = true;
    if (this.currentUtterance) {
      window.speechSynthesis.cancel();
    }
  }

  rewind() {
    if (!this.shadowRoot) {
      console.warn('ExplainerPlayer not fully initialized yet');
      return;
    }
    
    this.pause();
    this.currentIndex = 0;
    const slider = this.shadowRoot?.getElementById('progress-slider');
    if (slider) {
      slider.value = '0';
    }
    this.fastRedraw(0);
  }

  toggleSubtitles() {
    this.showSubtitles = !this.showSubtitles;
  }
}

// Register the web component
customElements.define('explainer-player', ExplainerPlayer);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExplainerPlayer;
}
