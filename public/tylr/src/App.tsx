import './App.css';
import Footer from './Footer';
import Messenger_logo from './assets/Messenger_logo.svg';
import WhatsApp_logo from './assets/WhatsApp_logo.svg';
import Instagram_logo from './assets/Instagram_logo.svg';
import github_mark from './assets/github-mark.svg';
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    // Apply theme based on user preference
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches;
    const theme = prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);

    // Set current year
    const currentYearElement = document.getElementById('current-year');
    if (currentYearElement) {
      currentYearElement.textContent = new Date().getFullYear().toString();
    }

    // On load animation
    setTimeout(() => {
      const logoContainer = document.getElementById('logo-container');
      if (logoContainer) {
        logoContainer.classList.add('animate');
      }
    }, 800);
  }, []);

  const handleHelixClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    // Toggle active state on the button
    const helixButton = document.getElementById('helix') as HTMLAnchorElement;
    helixButton.classList.toggle('active');

    // Toggle visibility of chat links
    const chatLinks = document.getElementById('chat-links');
    if (chatLinks) {
      chatLinks.classList.toggle('visible');
    }

    // Fallback navigation mechanism
    if (!helixButton.classList.contains('active')) {
      window.location.href = helixButton.href;
    }
  };

  return (
    <>
      <div id="logo-container">
        <div id="tyler-text">
          <span className="left-part">Ty</span>
          <span id="slash">/</span>
          <span className="right-part">r</span>
        </div>
      </div>

      <div id="main-tiles">
        <a href="#" id="helix" className="button" onClick={handleHelixClick}>
          <span>helix-project</span>
        </a>
        <a
          href="#"
          id="resume"
          className="button disabled"
          aria-disabled="true"
        >
          <span>resumé</span>
        </a>
        <a
          href="#"
          id="portfolio"
          className="button disabled"
          aria-disabled="true"
        >
          <span>portfolio</span>
        </a>
      </div>

      <div id="chat-links">
        <a
          className="social-link"
          href="https://m.me/tylrcreative"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={Messenger_logo} alt="Chat Tylr on Messenger" />
        </a>
        <a
          className="social-link"
          href="https://wa.me/message/4HK74L3CLAAVE1"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={WhatsApp_logo} alt="Chat Tylr on WhatsApp" />
        </a>
        <a
          className="social-link"
          href="#"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={Instagram_logo} alt="Chat Tylr on Instagram" />
        </a>
        <a
          className="social-link"
          href="https://github.com/tylr-r/helix"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src={github_mark}
            alt="View project on GitHub"
            className="github-logo"
          />
        </a>
      </div>
      <Footer />
    </>
  );
}

export default App;
