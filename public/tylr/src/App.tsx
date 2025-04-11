import './App.css';
import Footer from './Footer';
import Messenger_logo from './assets/Messenger_logo.svg';
import WhatsApp_logo from './assets/WhatsApp_logo.svg';
import github_mark from './assets/github-mark.svg';
import ToggleButton from './ToggleButton';
import { useEffect, useState } from 'react';

function App() {
  const [isHelixLinksActive, setIsHelixLinksActive] = useState(false);

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
        <ToggleButton
          label="helix project"
          id="helix-button"
          onClick={() => setIsHelixLinksActive((prevState) => !prevState)}
        />
        <ToggleButton label="resume" id="resume-button" isDisabled />
        <ToggleButton label="portfolio" id="portfolio-button" isDisabled />
      </div>

      <div id="chat-links" className={isHelixLinksActive ? 'visible' : ''}>
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
