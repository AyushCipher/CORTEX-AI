// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GithubAuthProvider, GoogleAuthProvider } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey:import.meta.env.VITE_FIREBASE_API_KEY ,
  authDomain: "ayush-s-project-1bd13.firebaseapp.com",
  projectId: "ayush-s-project-1bd13",
  storageBucket: "ayush-s-project-1bd13.firebasestorage.app",
  messagingSenderId: "352013897137",
  appId: "1:352013897137:web:f36d23273a0a5e69d68190",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth=getAuth(app)
export const googleProvider =
  new GoogleAuthProvider();

export const githubProvider =
  new GithubAuthProvider();