import React from 'react';

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{
    keys: string[];
    description: string;
  }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Show keyboard shortcuts' },
      { keys: ['Ctrl', 'S'], description: 'Save current annotation' },
      { keys: ['Ctrl', 'E'], description: 'Export data' },
      { keys: ['Ctrl', 'U'], description: 'Upload screenshot' },
      { keys: ['Escape'], description: 'Close dialog or cancel' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Tab'], description: 'Move to next field' },
      { keys: ['Shift', 'Tab'], description: 'Move to previous field' },
      { keys: ['Enter'], description: 'Confirm or submit' },
      { keys: ['Arrow Keys'], description: 'Navigate grid cells' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], description: 'Undo last change' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo last change' },
      { keys: ['Ctrl', 'A'], description: 'Select all' },
      { keys: ['Delete'], description: 'Clear selected value' },
    ],
  },
  {
    title: 'Grid Selection',
    shortcuts: [
      { keys: ['Click', 'Drag'], description: 'Select grid corners' },
      { keys: ['+', '-'], description: 'Zoom in/out' },
      { keys: ['Space'], description: 'Toggle zoom mode' },
    ],
  },
];

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcuts: React.FC<KeyboardShortcutsProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const formatKey = (key: string): string => {
    if (isMac && key === 'Ctrl') return 'Cmd';
    if (isMac && key === 'Alt') return 'Option';
    return key;
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Keyboard Shortcuts</h2>
              <p className="text-sm text-gray-500 mt-1">
                {isMac ? 'macOS' : 'Windows/Linux'} shortcuts
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close dialog"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="space-y-6">
            {SHORTCUT_GROUPS.map((group, groupIdx) => (
              <div key={groupIdx}>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{group.title}</h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut, shortcutIdx) => (
                    <div
                      key={shortcutIdx}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <span className="text-gray-700">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIdx) => (
                          <React.Fragment key={keyIdx}>
                            <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-white border border-gray-300 rounded shadow-sm">
                              {formatKey(key)}
                            </kbd>
                            {keyIdx < shortcut.keys.length - 1 && (
                              <span className="text-gray-400 text-sm">+</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">Pro Tip:</p>
                  <p>
                    Press <kbd className="px-1 py-0.5 text-xs bg-white border border-blue-300 rounded">Ctrl/Cmd</kbd> +{' '}
                    <kbd className="px-1 py-0.5 text-xs bg-white border border-blue-300 rounded">K</kbd> anywhere
                    in the app to bring up this shortcuts panel.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const useKeyboardShortcuts = (onShortcut: (shortcut: string) => void) => {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? event.metaKey : event.ctrlKey;

      if (modKey && event.key === 'k') {
        event.preventDefault();
        onShortcut('show-shortcuts');
      } else if (modKey && event.key === 's') {
        event.preventDefault();
        onShortcut('save');
      } else if (modKey && event.key === 'e') {
        event.preventDefault();
        onShortcut('export');
      } else if (modKey && event.key === 'u') {
        event.preventDefault();
        onShortcut('upload');
      } else if (event.key === 'Escape') {
        onShortcut('escape');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onShortcut]);
};
