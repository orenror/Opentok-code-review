import React from "react";
import OpentokLogger from "../TrainingVideoChat/services/opentokLogger";

let otVideoProps = {
  insertMode: "append",
  showControls: false,
  width: "100%",
  height: "100%"
};

const isLogEnabled = () => {
  let isLogEnabled = false;
  let domain = window.location.origin;
  if (domain.indexOf("localhost") > -1 || domain.indexOf("dev") > -1) {
    isLogEnabled = true;
  }
  return isLogEnabled;
};

class OpentokComponent extends React.Component {

  _otSession = null;
  _mounted = false;
  _movingAvg = null;

  constructor(props) {
    super(props);
    this.state = {
      isLogEnabled: isLogEnabled(),
      initialized: false,
      subscriberStream: null,
      shareScreenStream: null,
      sessionConnectRetries: 0
    };

    if (this.state.isLogEnabled) {
      OpentokLogger.setUserType(props.userType);
    }
  }

  componentWillMount() {
    this.initOpentok();
  }

  componentDidMount() {
    this._mounted = true;
  }

  componentWillReceiveProps(nextProps, nextContext) {
    if (nextProps.publishVideo !== this.props.publishVideo) {
      this.state.publisher.publishVideo(nextProps.publishVideo);
    }

    if (nextProps.publishAudio !== this.props.publishAudio) {
      this.state.publisher.publishAudio(nextProps.publishAudio);
    }
  }

  componentWillUnmount() {
    this._mounted = false;

    const { publisher, subscriber } = this.state;

    if (subscriber) {
      subscriber.off("audioLevelUpdated");

      if (this._otSession) {
        this._otSession.unsubscribe(subscriber);
      }
    }

    if (publisher) {
      publisher.off("streamDestroyed");
      publisher.off("audioLevelUpdated");

      if (this._otSession) {
        this._otSession.unpublish(publisher);
      }
      publisher.destroy();
    }

    if (this._otSession) {
      this._otSession.off("sessionDisconnected");
      this._otSession.off("sessionReconnected");
      this._otSession.off("sessionReconnecting");
      this._otSession.off("streamCreated");
      this._otSession.off("streamPropertyChanged");
      this._otSession.off("streamDestroyed");
      this._otSession.disconnect();

      this._otSession = null;
    }
  }

  initOpentok() {
    const self = this;
    const { initialized } = this.state;
    const { sessionData } = this.props;
    if (initialized || !sessionData.sessionId || !sessionData.token || !sessionData.apiKey) {
      return;
    }

    OT.on("exception", this.otException.bind(self));

    this._otSession = OT.initSession(sessionData.apiKey, sessionData.sessionId);

    this._otSession.on("sessionDisconnected", this.sessionDisconnected.bind(self));

    this._otSession.on("sessionReconnected", this.sessionReconnected.bind(self));

    this._otSession.on("sessionReconnecting", this.sessionReconnecting.bind(self));

    this._otSession.on("streamCreated", this.streamCreated.bind(self));

    this._otSession.on("streamPropertyChanged", this.streamPropertyChanged.bind(self));

    this._otSession.on("streamDestroyed", this.streamDestroyed.bind(self));

    this._otSession.connect(sessionData.token, this.sessionConnect.bind(self));

    this.setState({
      initialized: true
    });
  }

  otException(error) {
    this.writeOpentokLog("OT Exception", error.message, true);
  }

  tryReconnect() {
    this.writeOpentokLog(`session connect retry ${this.state.sessionConnectRetries + 1}`, "", false);

    if (this.state.sessionConnectRetries <= 2) {
      this.setState({
        sessionConnectRetries: this.state.sessionConnectRetries + 1
      }, () => {
        this._otSession.connect(this.props.sessionData.token, this.sessionConnect.bind(this));
      });

    } else {
      this.writeOpentokLog(`session connect failed after ${this.state.sessionConnectRetries} retries`, "", false);
      if (typeof this.props.onSessionConnectError === "function") {
        this.props.onSessionConnectError();
      }
    }
  }

  sessionConnect(error) {
    this.writeOpentokLog("session connect", "");

    const self = this;

    if (error) {
      this.writeOpentokLog("session connect error", error.message, true);
      this.tryReconnect();
    } else {
      otVideoProps = {
        ...otVideoProps,
        publishAudio: this.props.publishAudio,
        publishVideo: this.props.publishVideo
      };
      const publisher = OT.initPublisher(this.props.publisherElementId, otVideoProps, function(error) {
        if (error) {
          self.writeOpentokLog("init publisher error", error.message, true);
          // to do:
          // retry to init publisher??
        } else {
          publisher.on("streamDestroyed", self.publisherStreamDestroyed.bind(self));

          publisher.on("audioLevelUpdated", self.publisherAudioLevelUpdated.bind(self));

          self._otSession.publish(publisher);

          self.setState({ publisher });

          if (typeof self.props.onSessionConnect === "function") {
            self.props.onSessionConnect(self._otSession);
          }
        }
      });
    }
  }

  sessionDisconnected(event) {
    this.writeOpentokLog("session disconnect", event.reason);
    if (typeof this.props.onSssionDisconnected === "function") {
      this.props.onSssionDisconnected(event);
    }
  }

  sessionReconnected(event) {
    this.writeOpentokLog("session reconnected", event);

    if (typeof this.props.onSessionReconnected === "function") {
      this.props.onSessionReconnected();
    }
  }

  sessionReconnecting(event) {
    this.writeOpentokLog("session reconnecting", event);

    if (typeof this.props.onSessionReconnecting === "function") {
      this.props.onSessionReconnecting();
    }
  }

  streamCreated(event) {
    this.writeOpentokLog("stream created", event.type);

    let { subscriberStream, shareScreenStream } = this.state;

    if (!subscriberStream && event.stream.videoType === "camera") {
      const subscriber = this._otSession.subscribe(event.stream, this.props.subscriberElementId, otVideoProps);

      subscriber.on("audioLevelUpdated", this.audioLevelUpdated.bind(this));

      this.writeOpentokLog("subscribe session", "");

      if (typeof this.props.onStreamCreated === "function") {
        this.props.onStreamCreated(event, subscriber);
      }

      this.setState({
        subscriber: subscriber,
        subscriberStreamId: event.stream.id,
        subscriberStream: event.stream
      });
    }

    if (!shareScreenStream && event.stream.videoType === "screen") {

      if (typeof this.props.onStreamsUpdated === "function") {
        this.props.onStreamsUpdated(event.stream);
      }

      this.setState({
        shareScreenStreamId: event.stream.id,
        shareScreenStream: event.stream
      }, () => {
        this.writeOpentokLog("subscribe share screen session", "");
        this._otSession.subscribe(event.stream, this.props.shareScreenElementId, otVideoProps);
      });
    }
  }

  streamDestroyed(event) {
    if (event.stream.id === this.state.shareScreenStreamId) {
      if (typeof this.props.onScreenShareEnd === "function") {
        this.props.onScreenShareEnd();
      }
    }
  }

  publisherStreamDestroyed(event) {
    event.preventDefault();
    this.writeOpentokLog("stream destroyed", event.reason, true);
  }

  streamPropertyChanged(event) {
    this.writeOpentokLog("stream property changed", event.changedProperty);

    if (typeof this.props.onStreamPropertyChanged === "function") {
      this.props.onStreamPropertyChanged(event);
    }
  }

  writeOpentokLog(eventName, eventInfo, isError) {
    if (this.state.isLogEnabled) {
      console.log(`--->OpentokComponent::${eventName}. ${isError ? "error=" : "info="}${eventName}`);
      OpentokLogger.writeVideoChatLog(eventName, this.props.sessionData.sessionId, eventInfo);
    }
  }

  audioLevelUpdated(event) {
    const logLevel = this.getVolumeLevel(event);

    if (typeof this.props.onAudioLevelUpdated === "function") {
      this.props.onAudioLevelUpdated(logLevel);
    }
  }

  publisherAudioLevelUpdated(event) {
    const logLevel = this.getVolumeLevel(event);

    if (typeof this.props.publisherAudioLevelUpdated === "function") {
      this.props.publisherAudioLevelUpdated(logLevel);
    }
  }

  getVolumeLevel(event) {
    if (this._movingAvg === null || this._movingAvg <= event.audioLevel) {
      this._movingAvg = event.audioLevel;
    } else {
      this._movingAvg = 0.7 * this._movingAvg + 0.3 * event.audioLevel;
    }

    let logLevel = (Math.log(this._movingAvg) / Math.LN10) / 1.5 + 1;
    logLevel = Math.min(Math.max(logLevel, 0), 1);
    return `${logLevel * 100}%`;
  }

  render() {
    return <></>;
  }
}

export default OpentokComponent;

