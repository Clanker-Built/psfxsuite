import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { mailApi } from '@/lib/api';

interface Contact {
  email: string;
  name?: string;
}

interface ContactAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

// Parse email addresses from comma-separated string
function parseEmails(value: string): Contact[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => {
      // Try to extract name from "Name <email>" format
      const match = email.match(/^(.+?)\s*<(.+?)>$/);
      if (match) {
        return { name: match[1].trim(), email: match[2].trim() };
      }
      return { email };
    });
}

// Format contacts back to string
function formatEmails(contacts: Contact[]): string {
  return contacts
    .map((c) => (c.name ? `${c.name} <${c.email}>` : c.email))
    .join(', ');
}

export function ContactAutocomplete({
  value,
  onChange,
  placeholder = 'Enter email addresses...',
  className,
  id,
}: ContactAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse existing contacts from value
  const contacts = parseEmails(value);

  // Query for contact suggestions from the backend
  const { data: suggestions = [] } = useQuery({
    queryKey: ['mail', 'contacts', 'search', inputValue],
    queryFn: async () => {
      if (!inputValue.trim()) return [];
      const results = await mailApi.searchContacts(inputValue);
      // Map to Contact interface
      return results.map((c) => ({ email: c.email, name: c.name }));
    },
    enabled: inputValue.length >= 2,
    staleTime: 10000,
  });

  // Filter suggestions to exclude already selected contacts
  const filteredSuggestions = suggestions.filter(
    (s) => !contacts.some((c) => c.email.toLowerCase() === s.email.toLowerCase())
  );

  // Add a contact
  const addContact = useCallback(
    (contact: Contact) => {
      const newContacts = [...contacts, contact];
      onChange(formatEmails(newContacts));
      setInputValue('');
      setShowSuggestions(false);
      setSelectedIndex(0);
      inputRef.current?.focus();
    },
    [contacts, onChange]
  );

  // Remove a contact
  const removeContact = useCallback(
    (index: number) => {
      const newContacts = contacts.filter((_, i) => i !== index);
      onChange(formatEmails(newContacts));
    },
    [contacts, onChange]
  );

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowSuggestions(newValue.length >= 2);
    setSelectedIndex(0);

    // If user types comma or semicolon, add the email
    if (newValue.endsWith(',') || newValue.endsWith(';')) {
      const email = newValue.slice(0, -1).trim();
      if (email && email.includes('@')) {
        addContact({ email });
      }
    }
  };

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !inputValue && contacts.length > 0) {
      // Remove last contact when backspace is pressed on empty input
      removeContact(contacts.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && filteredSuggestions.length > 0) {
        // Select from suggestions
        addContact(filteredSuggestions[selectedIndex]);
      } else if (inputValue.trim() && inputValue.includes('@')) {
        // Add typed email
        addContact({ email: inputValue.trim() });
      }
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filteredSuggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'Tab' && inputValue.trim() && inputValue.includes('@')) {
      // Add email on tab
      e.preventDefault();
      addContact({ email: inputValue.trim() });
    }
  };

  // Handle blur - add email if valid
  const handleBlur = () => {
    // Delay to allow click on suggestions
    setTimeout(() => {
      if (inputValue.trim() && inputValue.includes('@')) {
        addContact({ email: inputValue.trim() });
      }
      setShowSuggestions(false);
    }, 200);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 min-h-10 px-3 py-1.5 border rounded-md bg-background',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Contact badges */}
        {contacts.map((contact, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="flex items-center gap-1 pr-1"
          >
            <User className="h-3 w-3" />
            {contact.name || contact.email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeContact(index);
              }}
              className="ml-1 hover:bg-muted rounded-full p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {/* Input field */}
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => inputValue.length >= 2 && setShowSuggestions(true)}
          placeholder={contacts.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
        />
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.email}
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-accent',
                index === selectedIndex && 'bg-accent'
              )}
              onClick={() => addContact(suggestion)}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                {suggestion.name && (
                  <div className="font-medium">{suggestion.name}</div>
                )}
                <div className={cn(suggestion.name && 'text-muted-foreground')}>
                  {suggestion.email}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ContactAutocomplete;
