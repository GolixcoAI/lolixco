import {PUBLIC_PAGES} from '../../config/publicPages';
export default function PublicInfo({view,onImmersion}:{view:string;onImmersion:()=>void}) {
 const page=PUBLIC_PAGES.find(item=>item.view===view);
 if(!page)return null;
 return <article className="help-page"><section className="help-section"><h1>{page.heading}</h1>{page.paragraphs.map(text=><p key={text}>{text.split(/((?:support|rights|hello)@golixco\.com)/g).map((part,index)=> /^(support|rights|hello)@golixco\.com$/.test(part) ? <a key={index} href={'mailto:'+part}>{part}</a> : part)}</p>)}{view==='Immersion'&&<button className="primary" onClick={onImmersion}>Enter Immersion</button>}<nav className="help-topics" aria-label="Product information">{PUBLIC_PAGES.filter(p=>['Help & Support','Privacy Policy','Copyright & Rights','Terms of Use','Public Beta'].includes(p.view)).map(p=><a key={p.path} href={p.path}>{p.view}</a>)}</nav></section></article>;
}
