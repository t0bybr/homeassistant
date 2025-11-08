(() => {
    const getAllNotificationItems = () => {
      const items = [];
      const seen = new Set();
      const stack = [document.body];

      while (stack.length) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);

        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches?.('notification-item')) items.push(node);
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }

        node.childNodes?.forEach(child => stack.push(child));
      }
      return items;
    };

     const textFromNode = root => {
      let buf = [];

      const walk = node => {
        if (!node) return;
        if (node.tagName === 'NOTIFICATION-ITEM') {
const cards = Array.from(node.shadowRoot.firstElementChild.shadowRoot.firstElementChild.childNodes);
          const t = cards[1].textContent + cards[3].shadowRoot.firstElementChild.textContent + cards[5].textContent;
          if (t) buf.push(t);
        }
        node.childNodes?.forEach(walk);
      };
      walk(root);
      return buf.join(' ').trim();
    };

    const rows = getAllNotificationItems()
      .map((el, idx) => `${idx + 1}. ${textFromNode(el)}`);

    const output = rows.join('\n\n');
    console.log(output || '(keine Notifications gefunden)');
    if (output && typeof copy === 'function') copy(output);
  })();
