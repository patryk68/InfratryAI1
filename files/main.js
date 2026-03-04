// ═══════════════════════════════
//  InfratryAI · main.js
// ═══════════════════════════════

// ── Hamburger ──
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('nav-links');

if (hamburger && navLinks) {
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    navLinks.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('open');
    }
  });
}

// ── Active nav link ──
const page = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-links a').forEach(a => {
  if (a.getAttribute('href') === page) a.classList.add('active');
});

// ── Scroll reveal ──
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
