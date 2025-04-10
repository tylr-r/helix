import './App.css';
import Footer from './Footer';
import Messenger_logo from './assets/Messenger_logo.svg';
import WhatsApp_logo from './assets/WhatsApp_logo.svg';
import Instagram_logo from './assets/Instagram_logo.svg';
import github_mark from './assets/github-mark.svg';

function App() {
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
        <a href="#" id="helix" className="button">
          <span>helix project</span>
        </a>
        <a href="#" id="resume" className="button" aria-disabled="true">
          <span>resumé</span>
        </a>
        <a href="#" id="portfolio" className="button" aria-disabled="true">
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
