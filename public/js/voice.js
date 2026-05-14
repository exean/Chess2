/* WebRTC voice chat between the two players of a room.
 * Signaling rides on the existing Socket.IO connection. Audio is
 * peer-to-peer (P2P) with public STUN servers - no TURN, so connections
 * behind strict NATs may fail.
 */
(function (root) {
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  class VoiceChat {
    constructor(socket) {
      this.socket = socket;
      this.pc = null;
      this.localStream = null;
      this.remoteStream = null;
      this.state = 'idle'; // idle | enabling | waiting | connecting | connected | error
      this.error = null;
      this.muted = false;

      // Pegel-Listener (0..1 lautstärke)
      this.localLevel = 0;
      this.remoteLevel = 0;
      this._localMeterStop = null;
      this._remoteMeterStop = null;

      // Observer-Callbacks
      this.onStateChange = () => {};
      this.onLevel = () => {};

      socket.on('voice:signal', (data) => this._handleSignal(data));
      socket.on('voice:start', (data) => this._handleStart(data));
      socket.on('voice:peer-left', () => this._handlePeerLeft());
    }

    _setState(s, err) {
      this.state = s;
      this.error = err || null;
      this.onStateChange(s, err || null);
    }

    async enable() {
      if (this.state !== 'idle' && this.state !== 'error') return;
      this._setState('enabling');
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        this._setState('error', err.name === 'NotAllowedError' ? 'Mikrofon-Zugriff verweigert' : (err.message || 'Mikrofon nicht verfügbar'));
        return;
      }
      this._localMeterStop = startLevelMeter(this.localStream, (lv) => {
        this.localLevel = lv;
        this.onLevel('local', lv);
      });
      this._setState('waiting');
      this.socket.emit('voice:state', { active: true });
    }

    async disable() {
      if (this.state === 'idle') return;
      this.socket.emit('voice:state', { active: false });
      this._cleanup();
      this._setState('idle');
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
      }
      this.onStateChange(this.state, this.error); // refresh UI
    }

    toggleMute() { this.setMuted(!this.muted); }

    _cleanup() {
      if (this._localMeterStop) { this._localMeterStop(); this._localMeterStop = null; }
      if (this._remoteMeterStop) { this._remoteMeterStop(); this._remoteMeterStop = null; }
      if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }
      if (this.localStream) { this.localStream.getTracks().forEach((t) => t.stop()); this.localStream = null; }
      this.remoteStream = null;
      this.localLevel = 0;
      this.remoteLevel = 0;
      this.muted = false;
      this.onLevel('local', 0);
      this.onLevel('remote', 0);
    }

    _setupPC() {
      if (this.pc) return;
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
      }
      this.pc.ontrack = (e) => {
        this.remoteStream = e.streams[0];
        if (this._remoteMeterStop) this._remoteMeterStop();
        this._remoteMeterStop = startLevelMeter(this.remoteStream, (lv) => {
          this.remoteLevel = lv;
          this.onLevel('remote', lv);
        });
        playRemoteAudio(this.remoteStream);
      };
      this.pc.onicecandidate = (e) => {
        if (e.candidate) this.socket.emit('voice:signal', { type: 'candidate', candidate: e.candidate });
      };
      this.pc.onconnectionstatechange = () => {
        const s = this.pc.connectionState;
        if (s === 'connected') this._setState('connected');
        else if (s === 'failed') this._setState('error', 'Verbindung fehlgeschlagen (NAT/Firewall)');
        else if (s === 'disconnected') this._setState('connecting');
      };
    }

    async _handleStart(data) {
      this._setState('connecting');
      this._setupPC();
      if (data && data.role === 'offerer') {
        try {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.socket.emit('voice:signal', { type: 'offer', sdp: offer.sdp });
        } catch (err) {
          this._setState('error', 'Verbindungsaufbau fehlgeschlagen');
        }
      }
      // answerer waits for offer to arrive via _handleSignal
    }

    async _handleSignal(data) {
      if (!data || !this.localStream) return;
      this._setupPC();
      try {
        if (data.type === 'offer') {
          await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.socket.emit('voice:signal', { type: 'answer', sdp: answer.sdp });
        } else if (data.type === 'answer') {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        } else if (data.type === 'candidate' && data.candidate) {
          await this.pc.addIceCandidate(data.candidate);
        }
      } catch (err) {
        console.warn('voice signal handling failed', err);
      }
    }

    _handlePeerLeft() {
      // Peer turned off voice or left. Drop the connection but keep our mic
      // hot so reconnect is fast if they come back.
      if (this._remoteMeterStop) { this._remoteMeterStop(); this._remoteMeterStop = null; }
      if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }
      this.remoteStream = null;
      this.remoteLevel = 0;
      this.onLevel('remote', 0);
      if (this.state !== 'idle' && this.state !== 'error') this._setState('waiting');
    }
  }

  // WebAudio level meter (0..1). Returns a stop function.
  function startLevelMeter(stream, callback) {
    let ctx, source, analyser, raf;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
    } catch (e) {
      return () => {};
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    let smoothed = 0;
    function tick() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v;
      const level = (sum / data.length) / 255;
      smoothed = smoothed * 0.7 + level * 0.3;
      callback(smoothed);
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      try { source.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    };
  }

  // Hidden audio element to play remote stream. Created on demand.
  let remoteAudio = null;
  function playRemoteAudio(stream) {
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      remoteAudio.style.display = 'none';
      document.body.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = stream;
    const p = remoteAudio.play();
    if (p && p.catch) p.catch(() => { /* iOS may block until user gesture - the mic-enable click counts */ });
  }

  root.Chess2Voice = { VoiceChat };
})(window);
