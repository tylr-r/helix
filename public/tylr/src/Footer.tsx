import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer>
      <strong>
        &copy; <span id="current-year">2025</span> Tyler Robinson
      </strong>{' '}
      | <a href="/privacy-policy.html">Privacy Policy</a>
    </footer>
  );
};

export default Footer;
