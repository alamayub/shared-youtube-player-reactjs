import React, { useState, useEffect, useRef } from "react";
import YouTube from "react-youtube";
import io from "socket.io-client";

const SOCKET_SERVER_URL = "http://localhost:3001";
const ROOM_ID = "default-room";
const IS_HOST = true; // set to false for viewers

export default function App() {
  const [socket, setSocket] = useState(null);
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [inputUrl, setInputUrl] = useState("");
  const playerRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);
    newSocket.emit("join-room", ROOM_ID, IS_HOST);

    newSocket.on(
      "init",
      ({ playlist, currentIndex, isPlaying, currentTime }) => {
        setPlaylist(playlist);
        setCurrentIndex(currentIndex);
        setIsPlaying(isPlaying);
        setCurrentTime(currentTime);
      }
    );

    newSocket.on("playlist-updated", setPlaylist);
    newSocket.on("play-video", ({ currentIndex, isPlaying }) => {
      setCurrentIndex(currentIndex);
      setIsPlaying(isPlaying);
    });
    newSocket.on("pause-video", () => setIsPlaying(false));
    newSocket.on("playback-time-update", (time) => {
      if (!playerRef.current) return;
      if (Math.abs(playerRef.current.getCurrentTime() - time) > 1) {
        isSeekingRef.current = true;
        playerRef.current.seekTo(time, true);
      }
    });

    return () => newSocket.disconnect();
  }, []);

  useEffect(() => {
    if (!playerRef.current) return;
    if (IS_HOST) {
      isPlaying
        ? playerRef.current.playVideo()
        : playerRef.current.pauseVideo();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying || !IS_HOST) return;
    const interval = setInterval(() => {
      const time = playerRef.current?.getCurrentTime();
      if (time != null) {
        setCurrentTime(time);
        socket.emit("playback-time-update", { roomId: ROOM_ID, time });
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
    const res = await fetch(
      `${SOCKET_SERVER_URL}/api/video-info?url=${encodeURIComponent(inputUrl)}`
    );
    const videoMeta = await res.json();
    socket.emit("add-video", { roomId: ROOM_ID, videoMeta });
    setInputUrl("");
  };

  const playVideoAtIndex = (index) => {
    if (IS_HOST) {
      setCurrentIndex(index);
      setIsPlaying(true);
      socket.emit("play-video", { roomId: ROOM_ID, index, isPlaying: true });
    }
  };

  const pauseVideo = () => {
    if (IS_HOST) {
      setIsPlaying(false);
      socket.emit("pause-video", { roomId: ROOM_ID });
    }
  };

  const onPlayerReady = (event) => {
    playerRef.current = event.target;
    if (currentTime) playerRef.current.seekTo(currentTime, true);
    if (isPlaying) playerRef.current.playVideo();
  };

  const onPlayerStateChange = (event) => {
    if (!IS_HOST) return;
    const YT = window.YT;
    if (
      event.data === YT.PlayerState.ENDED &&
      currentIndex + 1 < playlist.length
    ) {
      playVideoAtIndex(currentIndex + 1);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={inputUrl}
        onChange={(e) => setInputUrl(e.target.value)}
        placeholder="YouTube URL"
      />
      <button onClick={addVideo}>Add</button>

      <YouTube
        videoId={playlist[currentIndex]?.id}
        opts={{ playerVars: { autoplay: 1, rel: 0 } }}
        onReady={onPlayerReady}
        onStateChange={onPlayerStateChange}
      />

      <div>
        <button onClick={() => playVideoAtIndex(currentIndex)}>Play</button>
        <button onClick={pauseVideo}>Pause</button>
      </div>

      <ul>
        {playlist.map((video, i) => (
          <li key={video.id} onClick={() => IS_HOST && playVideoAtIndex(i)}>
            {video.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
