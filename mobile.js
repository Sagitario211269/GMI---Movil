'use strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
(() => {
  const $ = id => document.getElementById(id);
  const form = $('form');
  const msg = $('message');
  const photos = [];
  const pdfs = [];
  const photoInput = $('mobilePhotoInput');
  const pdfInput = $('mobilePdfInput');
  const key = 'gmi-movil-draft-v0.1.5';
  const attachmentStatus = () => $('message');
  const attachmentDbName = 'gmi-movil-attachments-v1';
  const attachmentDraftKey = 'current-draft';
  // Serializa escrituras: evita que una operación lenta sobrescriba un borrador más reciente.
  let attachmentSaveQueue = Promise.resolve();
  function openAttachmentDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no permite almacenamiento local de anexos.'));
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(attachmentDbName,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts');};
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(db);};
      req.onerror=()=>reject(req.error||new Error('No se pudo abrir la base local de anexos.'));
      req.onblocked=()=>reject(new Error('El almacenamiento local está bloqueado por otra pestaña de GMI. Cierre las demás pestañas e intente nuevamente.'));
    });
  }
  async function fileToStoredBlob(file) {
    const bytes=await file.arrayBuffer();
    return {name:file.name,size:file.size,type:file.type,blob:new Blob([bytes],{type:file.type})};
  }
  function saveAttachmentDraft() {
    const operation = attachmentSaveQueue.catch(() => {}).then(async () => {
      // Tomar la instantánea al ejecutar la operación, no antes de esperar la cola.
      const [storedPhotos, storedPdfs] = await Promise.all([
        Promise.all(photos.map(async p => ({ ...await fileToStoredBlob(p.file), caption: p.caption || p.name }))),
        Promise.all(pdfs.map(p => fileToStoredBlob(p.file)))
      ]);
      const db = await openAttachmentDb();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put({ version: 3, savedAt: Date.now(), photos: storedPhotos, pdfs: storedPdfs }, attachmentDraftKey);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Falló la escritura de los anexos.'));
          tx.onabort = () => reject(tx.error || new Error('Se canceló el guardado de anexos.'));
        });
      } finally { db.close(); }
    });
    attachmentSaveQueue = operation;
    return operation;
  }
  async function restoreAttachmentDraft() {
    await attachmentSaveQueue.catch(() => {});
    const db = await openAttachmentDb();
    let saved;
    try {
      saved = await new Promise((resolve, reject) => {
        const tx = db.transaction('drafts', 'readonly');
        const req = tx.objectStore('drafts').get(attachmentDraftKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('No se pudieron leer los anexos guardados.'));
        tx.onabort = () => reject(tx.error || new Error('Se canceló la lectura de anexos.'));
      });
    } finally { db.close(); }
    if (!saved) return false;
    // Construir las listas nuevas antes de sustituir las listas activas.
    const restoredPhotos = [];
    const restoredPdfs = [];
    for (const p of (Array.isArray(saved.photos) ? saved.photos : [])) {
      if (!p || !p.blob || typeof p.name !== 'string') continue;
      const blob = p.blob instanceof Blob ? p.blob : new Blob([p.blob], { type: p.type || 'image/jpeg' });
      const file = new File([blob], p.name, { type: p.type || blob.type || 'image/jpeg' });
      restoredPhotos.push({ file, name: p.name, size: p.size || blob.size, type: file.type, caption: p.caption || p.name, preview: URL.createObjectURL(blob) });
    }
    for (const p of (Array.isArray(saved.pdfs) ? saved.pdfs : [])) {
      if (!p || !p.blob || typeof p.name !== 'string') continue;
      const blob = p.blob instanceof Blob ? p.blob : new Blob([p.blob], { type: p.type || 'application/pdf' });
      const file = new File([blob], p.name, { type: p.type || blob.type || 'application/pdf' });
      restoredPdfs.push({ file, name: p.name, size: p.size || blob.size, type: file.type });
    }
    photos.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview); });
    photos.splice(0, photos.length, ...restoredPhotos);
    pdfs.splice(0, pdfs.length, ...restoredPdfs);
    renderFiles(photos, 'photosList', 'photoCount', 'photo');
    renderFiles(pdfs, 'pdfList', 'pdfCount', 'pdf');
    return true;
  }
  let pendingOficioBytes = null;
  const textFields = [...form.querySelectorAll('input:not([type=file]), select, textarea')];
  const setMessage = (text, type='') => { msg.textContent = text; msg.className = `message ${type}`; };
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  if (!$('fechaInforme').value) $('fechaInforme').value = today();
  if (!$('oficioFecha').value) $('oficioFecha').value = today();
  const cargoMap = {
    'DIRECTIVO DOCENTE':['Coordinador(a) académico(a)','Coordinador(a) de convivencia','Coordinador(a) académico(a) y de convivencia'],
    'DOCENTE':['Docente de aula','Docente Orientador','Docente de Apoyo','Docente PTA']
  };
  function updateCargos() {
    const select=$('cargoAutor'), old=select.value; select.replaceChildren(new Option('Seleccione...',''));
    (cargoMap[$('tipoPersonal').value]||[]).forEach(c=>select.add(new Option(c,c)));
    select.disabled=!$('tipoPersonal').value; if ([...select.options].some(o=>o.value===old)) select.value=old;
  }
  const typeMap = {
    'Eventos / Celebraciones / Conmemoraciones':'eventContentSection',
    'Reporte Bajo Rendimiento Académico y Seguimiento':'academicContentSection',
    'Informe/Remisión Aula de Apoyo':'supportContentSection',
    'Informe/Remisión a Coordinación':'coordinationContentSection',
    'Informe/Remisión a Orientación':'orientationContentSection',
    'Novedades de Convivencia':'convivenciaContentSection',
    'Informe/Remisión a Rectoría':'rectoriaContentSection'
  };
  function updateTemplate() {
    const chosen=$('tipoInforme').value;
    ['generalContentSection',...Object.values(typeMap)].forEach(id=>$(id)?.classList.add('hidden'));
    if (!chosen) return;
    if (!typeMap[chosen]) $('generalContentSection').classList.remove('hidden'); else $(typeMap[chosen]).classList.remove('hidden');
  }
  function saveDraft() {
    try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(textFields.map(el=>[el.id,el.value])))); }
    catch(e) { setMessage('No fue posible guardar el borrador en este navegador. Exporte o copie la información antes de cerrar.', 'error'); }
  }
  function restoreDraft() {
    try {
      const saved=JSON.parse(localStorage.getItem(key)||'{}');
      // Primero restaurar el tipo de personal y crear sus opciones de cargo.
      if (Object.prototype.hasOwnProperty.call(saved,'tipoPersonal')) $('tipoPersonal').value=saved.tipoPersonal;
      updateCargos();
      // Después restaurar el resto de campos, incluido el valor del selector dependiente.
      textFields.forEach(el=>{
        if (el.id !== 'tipoPersonal' && Object.prototype.hasOwnProperty.call(saved,el.id)) {
          const value=saved[el.id];
          if (el.id !== 'cargoAutor' || [...el.options].some(option=>option.value===value)) el.value=value;
        }
      });
    } catch(e) { console.warn('No fue posible restaurar el borrador local.',e); }
  }
  function renderFiles(list, containerId, countId, kind) {
    const box=$(containerId); box.replaceChildren();
    $(countId).textContent=list.length ? `${list.length} ${kind==='photo'?'fotografía(s)':'documento(s) PDF'} seleccionado(s).` : (kind==='photo'?'No hay fotografías seleccionadas.':'No hay documentos PDF seleccionados.');
    list.forEach((file,index)=>{
      const row=document.createElement('div'); row.className=kind==='photo'?'photo-item':'pdf-item';
      if(kind==='photo'){
        const thumb=document.createElement('div'); thumb.className='photo-thumb'; const image=document.createElement('img'); image.src=file.preview; image.alt=file.name; thumb.append(image);
        const details=document.createElement('div'); details.className='photo-details'; const name=document.createElement('div'); name.className='photo-name'; name.textContent=file.name;
        const label=document.createElement('label'); label.textContent=`Descripción de la fotografía ${index+1}`; const caption=document.createElement('input'); caption.value=file.caption; caption.maxLength=220; caption.placeholder='Descripción breve (opcional)'; caption.addEventListener('input',()=>{file.caption=caption.value;saveAttachmentDraft().catch(()=>setMessage('No fue posible guardar los anexos localmente.','error'));}); label.append(caption); details.append(name,label); row.append(thumb,details);
      } else { const name=document.createElement('span'); name.className='pdf-name'; name.textContent=file.name; row.append(name); }
      const remove=document.createElement('button'); remove.type='button'; remove.className='secondary'; remove.textContent='Quitar'; remove.addEventListener('click',()=>{ if(kind==='photo') URL.revokeObjectURL(file.preview); list.splice(index,1); renderFiles(list,containerId,countId,kind); saveAttachmentDraft().catch(()=>setMessage('No fue posible actualizar los anexos guardados.','error')); }); row.append(remove); box.append(row);
    });
  }
  $('tipoPersonal').addEventListener('change',()=>{updateCargos();saveDraft();}); $('tipoInforme').addEventListener('change',()=>{updateTemplate();saveDraft();});
  textFields.forEach(el=>el.addEventListener('input',saveDraft));
  $('addPhotos').addEventListener('click',()=>photoInput.click());
  photoInput.addEventListener('change',()=>{
    const chosen=[...photoInput.files];
    if(photos.length+chosen.length>40){setMessage('Puede anexar máximo 40 fotografías por informe.','error');photoInput.value='';return;}
    for(const file of chosen){ if(!['image/jpeg','image/png'].includes(file.type)||file.size>25*1024*1024){setMessage(`Archivo no admitido o superior a 25 MB: ${file.name}`,'error');continue;} if(!photos.some(p=>p.name===file.name&&p.size===file.size)){photos.push({file,name:file.name,size:file.size,caption:file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' '),preview:URL.createObjectURL(file)});}}
    renderFiles(photos,'photosList','photoCount','photo'); photoInput.value=''; saveAttachmentDraft().then(()=>setMessage('Fotografías guardadas en este dispositivo.')).catch(e=>setMessage(`No fue posible guardar las fotografías: ${e.message||'error de almacenamiento'}`,'error'));
  });
  $('addPdfs').addEventListener('click',()=>pdfInput.click());
  pdfInput.addEventListener('change',()=>{
    const chosen=[...pdfInput.files];
    if(pdfs.length+chosen.length>20){setMessage('Puede anexar máximo 20 documentos PDF por informe.','error');pdfInput.value='';return;}
    for(const file of chosen){if(file.type!=='application/pdf'||file.size>50*1024*1024){setMessage(`Archivo no admitido o superior a 50 MB: ${file.name}`,'error');continue;} if(!pdfs.some(p=>p.name===file.name&&p.size===file.size))pdfs.push({file,name:file.name,size:file.size});}
    renderFiles(pdfs,'pdfList','pdfCount','pdf'); pdfInput.value=''; saveAttachmentDraft().then(()=>setMessage('Archivos PDF guardados en este dispositivo.')).catch(e=>setMessage(`No fue posible guardar los PDF: ${e.message||'error de almacenamiento'}`,'error'));
  });
  $('openOficio').addEventListener('click',()=>{ $('oficioSection').classList.remove('hidden'); $('oficioFecha').value=$('oficioFecha').value||today(); $('oficioSection').scrollIntoView({behavior:'smooth'}); });
  $('closeOficio').addEventListener('click',()=>$('oficioSection').classList.add('hidden'));
  function safeName(s){return (s||'GMI_Informe').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,90)||'GMI_Informe';}
  function downloadBytes(bytes, filename, mime='application/pdf'){
    const blob=new Blob([bytes],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function outputFilename(fallback){
    const raw=($('outputFilename')?.value||'').trim() || fallback || 'GMI_Informe.pdf';
    let name=raw.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');
    if(!name) name='GMI_Informe';
    if(!/\.pdf$/i.test(name)) name += '.pdf';
    return name.slice(0,136).replace(/\.pdf$/i,'')+'.pdf';
  }
  async function saveOrSharePdf(bytes, filename, saveHandle=null){
    if(saveHandle){
      const writable=await saveHandle.createWritable();
      await writable.write(new Blob([bytes],{type:'application/pdf'}));
      await writable.close();
      setMessage(`PDF guardado correctamente: ${filename}`);
      return;
    }
    const file=new File([bytes],filename,{type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title:filename});setMessage('Se abrió el menú para compartir el PDF. La recepción depende de la aplicación y del destinatario.');return;}catch(e){if(e.name==='AbortError'){setMessage('Compartir fue cancelado. El PDF también se descargará.');}}
    }
    downloadBytes(bytes,filename);setMessage('PDF generado y descargado. Para elegir la carpeta, active la opción de preguntar dónde guardar las descargas en el navegador.');
  }
  async function chooseSaveHandle(filename){
    if(typeof window.showSaveFilePicker!=='function') return null;
    try{return await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Documento PDF',accept:{'application/pdf':['.pdf']}}]});}
    catch(e){if(e && e.name==='AbortError') return false;return null;}
  }
  function getVisibleSections(){
    const chosen=$('tipoInforme').value; const sections=[...form.querySelectorAll('section:not(.hidden)')];
    const out=[];
    for(const sec of sections){
      if(['photosSection','pdfSection','oficioSection'].includes(sec.id)) continue;
      const fields=[...sec.querySelectorAll('input:not([type=file]):not([type=hidden]), select, textarea')].filter(el=>el.id && el.value.trim() && !el.disabled);
      for(const el of fields){
        const label=el.closest('label')?.childNodes?.[0]?.textContent?.replace(/\*/g,'').replace(/\(opcional\)/ig,'').trim() || el.id;
        out.push([label,el.value.trim()]);
      }
    }
    return out;
  }
  function wrap(text,font,size,maxWidth){
    const words=String(text||'').split(/\s+/);const lines=[];let line='';
    for(const word of words){const test=line?line+' '+word:word;if(font.widthOfTextAtSize(test,size)>maxWidth&&line){lines.push(line);line=word;}else line=test;}
    if(line)lines.push(line);return lines;
  }
  async function loadInstitutionalBanner(doc){
    // El recurso vive junto a index.html: evita depender de rutas relativas fuera de /app.
    const url = new URL('./encabezado-institucional.png', document.baseURI);
    const response = await fetch(url.href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo cargar el encabezado institucional (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error('El archivo del encabezado institucional está vacío.');
    try { return await doc.embedPng(bytes); }
    catch { throw new Error('El encabezado institucional no es un PNG válido para incorporarlo al PDF.'); }
  }
  async function createPdf({includeOficio=false}={}){
    const tipo=$('tipoInforme').value;
    if(!tipo){throw new Error('Seleccione el tipo de informe antes de generar el PDF.');}
    if($('periodoInicio').value&&$('periodoFin').value&&$('periodoFin').value<$('periodoInicio').value)throw new Error('La fecha final no puede ser anterior a la fecha inicial.');
    const doc=await PDFDocument.create(); const font=await doc.embedFont(StandardFonts.Helvetica); const bold=await doc.embedFont(StandardFonts.HelveticaBold);
    const W=595.28,H=841.89,M=48,usable=W-2*M; let page,y,pageNo=0;
    if(includeOficio&&pendingOficioBytes){const od=await PDFDocument.load(pendingOficioBytes);const copied=await doc.copyPages(od,od.getPageIndices());copied.forEach(p=>doc.addPage(p));pageNo=copied.length;}
    const banner=await loadInstitutionalBanner(doc);
    const newPage=()=>{page=doc.addPage([W,H]);pageNo++;const scale=Math.min(usable/banner.width,80/banner.height);const bw=banner.width*scale,bh=banner.height*scale;const bannerX=(W-bw)/2;page.drawImage(banner,{x:bannerX,y:H-14-bh,width:bw,height:bh});y=H-25-bh;page.drawLine({start:{x:M,y:28},end:{x:W-M,y:28},thickness:.5,color:rgb(.78,.81,.84)});page.drawText('Desarrollado por Mg. César Ávila',{x:M,y:15,size:7,font,color:rgb(.35,.38,.42)});page.drawText(`Página ${pageNo}`,{x:W-M-50,y:15,size:7,font,color:rgb(.35,.38,.42)});};
    const ensure=(need=30)=>{if(y-need<52)newPage();};
    const text=(str,size=10,isBold=false,color=rgb(.12,.17,.23))=>{const lines=wrap(str,isBold?bold:font,size,usable);for(const line of lines){ensure(size+7);page.drawText(line,{x:M,y,size,font:isBold?bold:font,color});y-=size+5;} };
    newPage();
    // Título principal centrado horizontalmente en la página PDF.
    const titleLines=wrap(tipo.toLocaleUpperCase('es-CO'),bold,15,usable);
    for(const line of titleLines){
      ensure(22);
      const lineWidth=bold.widthOfTextAtSize(line,15);
      page.drawText(line,{x:(W-lineWidth)/2,y,size:15,font:bold,color:rgb(.08,.22,.38)});
      y-=20;
    }
    y-=3;
    text(`Fecha del informe: ${$('fechaInforme').value||'No indicada'}`,9,false,rgb(.35,.38,.42));y-=8;
    const fields=[['Elaborado por',$('autor').value],['Tipo de personal',$('tipoPersonal').value],['Cargo',$('cargoAutor').value],['Sede',$('sede').value],['Jornada',$('jornada').value],['Destinatario',$('destinatario').value],['Asunto',$('asunto').value],['Periodo de los hechos',[ $('periodoInicio').value,$('periodoFin').value].filter(Boolean).join(' al ') ]].filter(x=>x[1]);
    // Metadatos en dos columnas: etiqueta arriba y valor debajo para aprovechar el ancho de la página.
    const colGap=24, colW=(usable-colGap)/2;
    for(let i=0;i<fields.length;i+=2){
      const row=fields.slice(i,i+2).map((field,j)=>({field,x:M+j*(colW+colGap)}));
      const wrapped=row.map(({field,x})=>({field,x,lines:wrap(field[1],font,9,colW)}));
      const maxLines=Math.max(...wrapped.map(item=>item.lines.length));
      const rowH=11+maxLines*12+5;ensure(rowH+4);
      for(const item of wrapped){
        page.drawText(item.field[0]+':',{x:item.x,y,size:8,font:bold,color:rgb(.34,.38,.42)});
        item.lines.forEach((line,k)=>page.drawText(line,{x:item.x,y:y-12-k*12,size:9,font,color:rgb(.12,.17,.23)}));
      }
      y-=rowH;
    }
    y-=5;page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.6,color:rgb(.75,.79,.83)});y-=18;
    const visibleContent=getVisibleSections();const skip=new Set(['Tipo de informe','Fecha del informe','Elaborado por','Tipo de personal','Cargo','Sede','Jornada','Destinatario','Asunto','Periodo de los hechos']);
    for(const [label,value] of visibleContent){if(skip.has(label)||/Seleccionar|Descripción de la fotografía/i.test(label))continue;ensure(30);text(label.toLocaleUpperCase('es-CO'),8.5,true,rgb(.08,.22,.38));text(value,10);y-=8;}
    // Evidencias fotográficas: imagen izquierda y descripción a la derecha, conservando proporción.
    for(const item of photos){let img;try{const bytes=await item.file.arrayBuffer();img=item.file.type==='image/png'?await doc.embedPng(bytes):await doc.embedJpg(bytes);}catch(e){throw new Error(`No se pudo leer la fotografía ${item.name}. Use un archivo JPG o PNG válido.`);}
      const imageBoxH=100;const maxW=190;const desc=wrap(item.caption||item.name,font,9,usable-maxW-18);const rowH=Math.max(imageBoxH,Math.max(1,desc.length)*13+12);ensure(rowH+30);const scale=Math.min(maxW/img.width,imageBoxH/img.height);const iw=img.width*scale,ih=img.height*scale;page.drawImage(img,{x:M,y:y-ih,width:iw,height:ih});let ty=y-10;for(const line of desc){page.drawText(line,{x:M+maxW+14,y:ty,size:9,font,color:rgb(.15,.18,.22)});ty-=13;}page.drawText(item.name,{x:M,y:y-rowH-12,size:7,font,color:rgb(.4,.4,.4)});y-=rowH+25;
    }
    // Anexar PDF seleccionados preservando sus páginas.
    for(const item of pdfs){try{const src=await PDFDocument.load(await item.file.arrayBuffer());const copied=await doc.copyPages(src,src.getPageIndices());copied.forEach(p=>doc.addPage(p));}catch(e){throw new Error(`No se pudo incorporar el PDF ${item.name}. Puede estar protegido o dañado.`);}}
    return await doc.save();
  }
  async function createOficioPdf(){
    const required=['oficioFecha','oficioDestinatario','oficioCargoDestinatario','oficioReferencia','oficioCuerpo','oficioFirmaNombre','oficioFirmaCargo'];
    const missing=required.filter(id=>!$(id).value.trim());if(missing.length)throw new Error('Complete los campos obligatorios del oficio antes de generarlo.');
    const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);const W=595.28,H=841.89,M=58;let page=doc.addPage([W,H]),y=H-60;
    const draw=(s,size=10,b=false,gap=15)=>{for(const line of wrap(s,b?bold:font,size,W-2*M)){if(y<70){page=doc.addPage([W,H]);y=H-60;}page.drawText(line,{x:M,y,size,font:b?bold:font,color:rgb(.12,.15,.19)});y-=size+4;}y-=gap;};
    const im=await loadInstitutionalBanner(doc);const sc=Math.min((W-2*M)/im.width,80/im.height);const iw=im.width*sc,ih=im.height*sc;page.drawImage(im,{x:(W-iw)/2,y:H-35-ih,width:iw,height:ih});y=H-45-ih;
    if($('oficioNumero').value.trim())draw($('oficioNumero').value,10,true,8);draw(`Villavicencio, ${$('oficioFecha').value}`,10,false,18);draw($('oficioTratamiento').value||'Señor(a)',10,true,2);draw($('oficioDestinatario').value,10,true,2);draw($('oficioCargoDestinatario').value,10,false,2);if($('oficioCiudad').value.trim())draw($('oficioCiudad').value,10,false,12);draw(`Ref.: ${$('oficioReferencia').value}`,10,true,14);draw($('oficioSaludo').value||'Respetado(a)',10,false,12);for(const para of $('oficioCuerpo').value.split(/\n\s*\n/))draw(para,10,false,8);draw($('oficioDespedida').value||'Cordialmente,',10,false,38);draw($('oficioFirmaNombre').value,10,true,2);draw($('oficioFirmaCargo').value,9,false,2);if($('oficioFirmaExtra').value.trim())draw($('oficioFirmaExtra').value,9,false,2);page.drawLine({start:{x:M,y:35},end:{x:W-M,y:35},thickness:.5,color:rgb(.78,.81,.84)});page.drawText('Desarrollado por Mg. César Ávila',{x:M,y:20,size:7,font,color:rgb(.35,.38,.42)});return await doc.save();
  }
  $('generateOficio').addEventListener('click',async()=>{try{const bytes=await createOficioPdf();const include=confirm('¿Desea incluir este oficio al comienzo del PDF completo?\n\nAceptar: preparar para incluirlo en el PDF completo.\nCancelar: descargar el oficio como PDF independiente.');if(include){pendingOficioBytes=bytes;setMessage('Oficio preparado en memoria para incluirse una sola vez al comienzo del PDF completo.');}else{await saveOrSharePdf(bytes,`GMI_Oficio_${safeName($('oficioReferencia').value)}.pdf`);pendingOficioBytes=null;}}catch(e){setMessage(e.message||'No fue posible generar el oficio.','error');}});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!form.reportValidity()) return;
    saveDraft();
    const fallback=`GMI_${safeName($('tipoInforme').value)}_${$('fechaInforme').value||today()}.pdf`;
    const name=outputFilename(fallback);
    try{
      // Abrir el selector antes de generar el PDF para conservar la activación del usuario.
      const handle=await chooseSaveHandle(name);
      if(handle===false){setMessage('Guardado cancelado. No se generó el PDF.');return;}
      setMessage('Generando PDF…');
      const bytes=await createPdf({includeOficio:!!pendingOficioBytes});
      await saveOrSharePdf(bytes,name,handle);
      pendingOficioBytes=null;
    }catch(err){setMessage(err.message||'No fue posible generar o guardar el PDF.','error');}
  });
  $('clear').addEventListener('click',()=>{if(!confirm('¿Limpiar el formulario y borrar el borrador local de este dispositivo?'))return; form.reset(); pendingOficioBytes=null; localStorage.removeItem(key); openAttachmentDb().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(attachmentDraftKey);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);})).catch(()=>{}); photos.forEach(p=>URL.revokeObjectURL(p.preview)); photos.splice(0);pdfs.splice(0);renderFiles(photos,'photosList','photoCount','photo');renderFiles(pdfs,'pdfList','pdfCount','pdf');$('oficioSection').classList.add('hidden');$('fechaInforme').value=today();$('oficioFecha').value=today();updateCargos();updateTemplate();setMessage('Formulario y borrador local eliminados.');});
  restoreDraft(); updateCargos(); updateTemplate(); renderFiles(photos,'photosList','photoCount','photo');renderFiles(pdfs,'pdfList','pdfCount','pdf');
  (async()=>{try{const restored=await restoreAttachmentDraft();if(restored)setMessage('Anexos recuperados del almacenamiento local.');}catch(e){console.error('No fue posible restaurar los anexos locales.',e);setMessage(`No fue posible recuperar los anexos: ${e.message||'error de almacenamiento'}`,'error');}})();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(reg=>reg.update()).catch(()=>{});
})();
