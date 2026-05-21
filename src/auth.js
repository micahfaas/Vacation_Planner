// Sign-in / sign-up screen, shown when no user session is active.
import { supabase } from './supabase.js';
import { el } from './dom.js';

export function signOut() {
  return supabase.auth.signOut();
}

// Render the auth screen into #vp-root. The onAuthStateChange listener in
// main.js takes over once a session is established.
export function renderAuthScreen() {
  const root = document.getElementById('vp-root');
  root.innerHTML = '';
  let mode = 'signin';

  const card = el('div', { class: 'vp-auth-card' });

  function draw(notice) {
    card.innerHTML = '';
    card.appendChild(el('h2', {}, 'Trip Planner'));
    card.appendChild(el('p', { class: 'vp-auth-sub' },
      mode === 'signin'
        ? 'Sign in to sync your trips across devices.'
        : 'Create an account to start planning.'));

    const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const pass = el('input', {
      type: 'password',
      placeholder: mode === 'signin' ? 'Password' : 'Password (min. 6 characters)',
      autocomplete: mode === 'signin' ? 'current-password' : 'new-password'
    });
    const msg = el('div', { class: 'vp-auth-msg' });
    if (notice) msg.textContent = notice;
    const submit = el('button', { class: 'vp-auth-submit' },
      mode === 'signin' ? 'Sign in' : 'Create account');

    function setMsg(text, isError) {
      msg.textContent = text;
      msg.classList.toggle('vp-auth-msg-error', !!isError);
    }

    async function doSubmit() {
      const e = email.value.trim();
      const p = pass.value;
      if (!e || !p) { setMsg('Enter your email and password.', true); return; }
      submit.disabled = true;
      submit.textContent = 'Please wait…';
      try {
        if (mode === 'signin') {
          const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.signUp({ email: e, password: p });
          if (error) throw error;
          const identities = data.user && data.user.identities;
          if (Array.isArray(identities) && identities.length === 0) {
            // Supabase returns an obfuscated user with no identities when the
            // email is already registered.
            mode = 'signin';
            draw('That email is already registered — please sign in.');
            return;
          }
          if (!data.session) {
            // email confirmation is enabled — no session yet
            mode = 'signin';
            draw('Account created. Check your email to confirm, then sign in.');
            return;
          }
        }
        // success: onAuthStateChange swaps in the app
      } catch (err) {
        setMsg(err && err.message ? err.message : 'Something went wrong.', true);
        submit.disabled = false;
        submit.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
      }
    }

    submit.addEventListener('click', doSubmit);
    email.addEventListener('keydown', ev => { if (ev.key === 'Enter') pass.focus(); });
    pass.addEventListener('keydown', ev => { if (ev.key === 'Enter') doSubmit(); });

    card.appendChild(el('label', {}, 'Email'));
    card.appendChild(email);
    card.appendChild(el('label', {}, 'Password'));
    card.appendChild(pass);
    card.appendChild(msg);
    card.appendChild(submit);

    const toggle = el('button', { class: 'vp-auth-toggle' },
      mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in');
    toggle.addEventListener('click', () => {
      mode = mode === 'signin' ? 'signup' : 'signin';
      draw();
    });
    card.appendChild(toggle);
  }

  draw();
  root.appendChild(el('div', { class: 'vp-auth-wrap' }, card));
}
