// ========== Drag and Drop Rearrangement ==========
const Rearrange = {
    init(containerId, saveCallback) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let draggedItem = null;

        container.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.server-card');
            if (!card) return;

            draggedItem = card;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.id);

            setTimeout(() => {
                card.style.opacity = '0.5';
                card.classList.add('dragging');
            }, 0);
        });

        container.addEventListener('dragend', (e) => {
            if (draggedItem) {
                draggedItem.style.opacity = '1';
                draggedItem.classList.remove('dragging');
            }
            draggedItem = null;

            // Remove drop indicators
            container.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const target = e.target.closest('.server-card');
            if (target && target !== draggedItem) {
                const rect = target.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                // For grid layout, we might want to check horizontal midpoint too, 
                // but usually simple "before/after" is enough for most users.
                if (e.clientY < midpoint) {
                    target.parentNode.insertBefore(draggedItem, target);
                } else {
                    target.parentNode.insertBefore(draggedItem, target.nextSibling);
                }
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            if (saveCallback) {
                const newOrder = Array.from(container.querySelectorAll('.server-card'))
                    .map(card => parseInt(card.dataset.id, 10));
                saveCallback(newOrder);
            }
        });
    }
};
