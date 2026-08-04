import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  messages: [],
  isLoading: false,
  artifacts: []
};

export const messageSlice = createSlice({
  name: "message",
  initialState,
  reducers: {
    setMessages: (state, action) => {
      state.messages = action.payload;
    },

    addMessage: (state, action) => {
      state.messages.push(action.payload);
    },
    appendToLastMessage: (state, action) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (lastMessage && lastMessage.role === "assistant") {
        lastMessage.content += action.payload;
      }
    },
    setLastMessageMeta: (state, action) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (lastMessage && lastMessage.role === "assistant") {
        Object.assign(lastMessage, action.payload);
      }
    },
    setIsLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    setArtifacts: (state, action) => {
      state.artifacts = action.payload;
    }
  }
});

// Action creators are generated for each case reducer function
export const {
  setMessages,
  addMessage,
  appendToLastMessage,
  setLastMessageMeta,
  setIsLoading,
  setArtifacts
} = messageSlice.actions;

export default messageSlice.reducer;
