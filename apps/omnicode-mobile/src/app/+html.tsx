import { ScrollViewStyleReset } from 'expo-router/html';
import React from 'react';

const css = `
  html, body {
    background-color: #0c0b09;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }
  ::selection {
    background: rgba(226, 189, 82, 0.25);
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: #0c0b09;
  }
  ::-webkit-scrollbar-thumb {
    background: #353021;
    border-radius: 8px;
    border: 2px solid #0c0b09;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #e2bd52;
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: #353021 #0c0b09;
  }
  :focus-visible {
    outline: 2px solid #e6c768;
    outline-offset: 3px;
  }
  input, textarea {
    outline: none;
  }
`;

export default function Html({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#0c0b09" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
