// Meme GIFs hosted on GIPHY. Only the links live here; the GIFs load from GIPHY when played.
// The 200w rendition is small, so it decodes fast and is plenty for an e-paper panel.
const giphy = id => `https://media.giphy.com/media/${id}/200w.gif`;

export const PRESETS = [
  { id: 'you-dont-say', title: 'you don\'t say', url: giphy('ECCEjxHQb2Qo') },
  { id: 'cage-lean', title: 'cage leans in', url: giphy('RrVzUOXldFe8M') },
  { id: 'cage-wtf', title: 'cage, what', url: giphy('J3l4ZjVkj37TW') },
  { id: 'cage', title: 'cage', url: giphy('XIxHCSnN0Oije') },
  { id: 'hell-yeah', title: 'hell yeah', url: giphy('cEYFeDB8PpXqYekMuPK') },
  { id: 'this-is-fine', title: 'this is fine', url: giphy('5GuExKmluBdrrtAFwk') },
  { id: 'computer-throw', title: 'computer, out the window', url: giphy('FXGoDrsgrNLj2') },
  { id: 'hackerman', title: 'hackerman', url: giphy('3knKct3fGqxhK') },
  { id: 'cat-keyboard', title: 'cat on the keyboard', url: giphy('JIX9t2j0ZTN9S') },
  { id: 'ship-it', title: 'ship it', url: giphy('LGzrggUppEBdm') },
  { id: '90s-internet', title: '90s internet', url: giphy('8TkagzJHXLWmI') },
  { id: 'hacker', title: 'hacking in progress', url: giphy('MM0Jrc8BHKx3y') },
  { id: 'hackers', title: 'hack the planet', url: giphy('Q2W4hziDOyzu0') },
  { id: 'downloading', title: 'downloading', url: giphy('l71kleRwrkxxK') },
  { id: 'internet-button', title: 'the internet button', url: giphy('13TF7Vc1vtaPT2') },
  { id: 'potato-server', title: 'potato server', url: giphy('ijvngPcd8kNOha4Se1') },
];

export const preset = id => PRESETS.find(p => p.id === id);
