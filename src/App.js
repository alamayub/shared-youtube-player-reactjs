import React, { useState, useEffect, useRef } from "react";
import YouTube from "react-youtube";
import io from "socket.io-client";

// const SOCKET_SERVER_URL = "http://localhost:3001";
const SOCKET_SERVER_URL = "https://shared-youtube-player-nodejs.onrender.com";
const ROOM_ID = "default-room";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputUrl, setInputUrl] = useState("");
  const playerRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const isSeekingRef = useRef(false);
  const ignoreNextPlayerEvent = useRef(false); // <-- new: to prevent loops

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.emit("join-room", ROOM_ID);

    newSocket.on("init", (state) => {
      setPlaylist(state.playlist || []);
      setCurrentIndex(state.currentIndex || 0);
      setIsPlaying(state.isPlaying || false);
      setCurrentTime(state.currentTime || 0);
    });

    newSocket.on("playlist-updated", (newPlaylist) => {
      setPlaylist(newPlaylist);
    });

    newSocket.on("play-video", ({ currentIndex: idx, isPlaying }) => {
      setCurrentIndex(idx);
      setIsPlaying(isPlaying);
    });

    newSocket.on("pause-video", () => {
      setIsPlaying(false);
    });

    newSocket.on("playback-time-update", (time) => {
      if (!playerRef.current) return;
      if (Math.abs(playerRef.current.getCurrentTime() - time) > 1) {
        isSeekingRef.current = true;
        playerRef.current.seekTo(time, true);
      }
    });

    return () => newSocket.disconnect();
  }, []);

  // When isPlaying changes, call playVideo or pauseVideo on player
  useEffect(() => {
    if (!playerRef.current) return;

    if (ignoreNextPlayerEvent.current) {
      ignoreNextPlayerEvent.current = false;
      return;
    }

    if (isPlaying) {
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [isPlaying]);

  // Sync current time every second when playing
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (playerRef.current) {
        const time = playerRef.current.getCurrentTime();
        setCurrentTime(time);
        socket?.emit("playback-time-update", { roomId: ROOM_ID, time });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, socket]);

  const extractVideoId = (url) => {
    const regex =
      /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|embed|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const addVideo = async () => {
    if (!inputUrl) return;
    const videoId = extractVideoId(inputUrl);
    if (!videoId) {
      alert("Invalid YouTube URL");
      return;
    }

    const res = await fetch(
      `${SOCKET_SERVER_URL}/api/video-info?url=${encodeURIComponent(inputUrl)}`
    );
    const videoMeta = await res.json();

    const newPlaylist = [...playlist, videoMeta];
    setPlaylist(newPlaylist);
    socket.emit("update-playlist", { roomId: ROOM_ID, playlist: newPlaylist });
    setInputUrl("");
  };

  const playVideoAtIndex = (index) => {
    setCurrentIndex(index);
    setIsPlaying(true);
    socket.emit("play-video", { roomId: ROOM_ID, index, isPlaying: true });
  };

  const pauseVideo = () => {
    setIsPlaying(false);
    socket.emit("pause-video", { roomId: ROOM_ID });
  };

  const nextVideo = () => {
    if (currentIndex + 1 < playlist.length) {
      playVideoAtIndex(currentIndex + 1);
    }
  };

  const prevVideo = () => {
    if (currentIndex > 0) {
      playVideoAtIndex(currentIndex - 1);
    }
  };

  const onPlayerReady = (event) => {
    playerRef.current = event.target;
    if (currentTime) {
      playerRef.current.seekTo(currentTime, true);
    }
    if (isPlaying) {
      playerRef.current.playVideo();
    }
  };

  const onPlayerStateChange = (event) => {
    const YT = window.YT;
    if (ignoreNextPlayerEvent.current) {
      ignoreNextPlayerEvent.current = false;
      return;
    }

    if (event.data === YT.PlayerState.PLAYING) {
      // Tell server only if state changed from pause
      ignoreNextPlayerEvent.current = true;
      setIsPlaying(true);
      socket.emit("play-video", {
        roomId: ROOM_ID,
        index: currentIndex,
        isPlaying: true,
      });
    } else if (event.data === YT.PlayerState.PAUSED) {
      ignoreNextPlayerEvent.current = true;
      setIsPlaying(false);
      socket.emit("pause-video", { roomId: ROOM_ID });
    } else if (event.data === YT.PlayerState.ENDED) {
      nextVideo();
    }

    if (isSeekingRef.current && event.data === YT.PlayerState.PLAYING) {
      isSeekingRef.current = false;
    }
  };

  return (
    <div className="app">
      <div className="input-container">
        <input
          type="text"
          placeholder="Enter YouTube video URL"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
        />
        <button onClick={addVideo}>Add Video</button>
      </div>

      {playlist.length > 0 && (
        <div className="playlist-container">
          <div className="video-player">
            <YouTube
              videoId={playlist[currentIndex]?.id}
              opts={{
                width: "100%",
                height: "360",
                playerVars: {
                  autoplay: isPlaying ? 1 : 0,
                  rel: 0,
                  modestbranding: 1,
                },
              }}
              onReady={onPlayerReady}
              onStateChange={onPlayerStateChange}
            />
            <div className="controls">
              <button onClick={prevVideo} disabled={currentIndex === 0}>
                Previous
              </button>
              {isPlaying ? (
                <button onClick={pauseVideo}>Pause</button>
              ) : (
                <button onClick={() => playVideoAtIndex(currentIndex)}>
                  Play
                </button>
              )}
              <button
                onClick={nextVideo}
                disabled={currentIndex === playlist.length - 1}
              >
                Next
              </button>
            </div>
          </div>
          <ul>
            {playlist.map((video, i) => (
              <li
                key={video.id}
                className={`${i === currentIndex ? "active" : ""}`}
                onClick={() => playVideoAtIndex(i)}
              >
                <img src={video.thumbnail_url} alt={video.title} />
                <div className="video-info">
                  <div
                    className="text-overflow-3"
                    style={{ fontWeight: "bold" }}
                  >
                    {video.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {video.author_name}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
