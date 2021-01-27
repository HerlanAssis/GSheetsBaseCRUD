/** UTILS */
function getColumnDataAsList(sheet, range){  
	let list = sheet.getRange(range).getValues();
	return list.filter((r) => r[0] !== "").map(item => item[0]);
}

function getSheetBy(url, name) {	
	return SpreadsheetApp.openByUrl(url).getSheetByName(name);
}

function getTypeAndSubtype(sheet, range, type = null) {  
  let interval = sheet.getRange(range).getValues();
  let data = {}

  interval.forEach(cell => {
    if(!(cell[0] in tipos)){
      data[cell[0]] = []  
    }
    data[cell[0]].push(cell[1])
  })

  return type ? data[type] : data;
}

function getNumberLastRowInUse(sheet, range) {
  var ct=0;
  var column = sheet.getRange(range);
  var values = column.getValues(); // get all data in one call  
  while ( values[ct] && values[ct][0] != "" ) {
    ct++;
  }
  return ++ct;
}

function getColumnNrByName(sheet, name) {
  const range = `${name}1`
  return sheet.getRange(range).getColumn();
}

function getCharFromNumber(columnNumber){
    var dividend = columnNumber;
    var columnName = "";
    var modulo;

    while (dividend > 0)
    {
        modulo = (dividend - 1) % 26;
        columnName = String.fromCharCode(65 + modulo).toString() + columnName;
        dividend = parseInt((dividend - modulo) / 26);
    } 
    return  columnName;
}
/** UTILS */

/** ERROS */
class ValidationError extends Error {
  constructor(field, message){
    super(`${field}: ${message}`)
  }
}
/** ERROS */

/** MODELS */
class GenericModel {
  constructor(sheet){
    this.sheet = sheet

    if(!sheet){
      throw new Error("Planilha não pode ser nula!");
    }  

    this.data_range.col_end = this.sheet.getMaxColumns()
    this.data_range.row_end = this.sheet.getMaxRows()
  }

  _getColumnRangeId(){
    return `${this.column_id}${this.data_range.row_start}:${this.column_id}`   
  }

  _getNextId(){
    const STRATEGY_ID_GENERATION = {
      'incremental': ()=> {    
        const column = this._getColumnRangeId()
        let lastID = `${this.column_id}${this.data_range.row_start}:${this.column_id}${getNumberLastRowInUse(this.sheet, column)}`
        return this.sheet.getRange(lastID).getValue()+1
      },
      'temporal': ()=> {
        return Date.now()
      },
      'hash':  ()=> {
        // Math.random should be unique because of its seeding algorithm.
        // Convert it to base 36 (numbers + letters), and grab the first 9 characters
        // after the decimal.
        return '_' + Math.random().toString(36).substr(2, 9);
      }
    }    

    return STRATEGY_ID_GENERATION[this.strategy_id]()
  }

  _getRowNumberById(id){
    const column_range_id = this._getColumnRangeId()        

    const id_array = this.sheet.getRange(column_range_id).getValues().map(item => item[0]).filter(item => item !=="")


    const rowNumber = id_array.findIndex(value => value === id)

    if(rowNumber === -1) throw new Error("ID não existe!")

    return rowNumber + this.data_range.row_start
  }

  _getNextRowToInsert(){
    const column_range_id = this._getColumnRangeId()      

    return getNumberLastRowInUse(this.sheet, column_range_id) + 1
  }
}

GenericModel.prototype.strategy_id = 'temporal'
GenericModel.prototype.data_range = {row_start: 2, row_end: -1, col_start: 1, col_end: -1}
GenericModel.prototype.column_id = 'A'
GenericModel.prototype.columns = []
GenericModel.prototype.triggers = []

//https://stackoverflow.com/questions/39435392/cant-get-getactivesheet-from-undefined
//https://developers.google.com/apps-script/guides/triggers/installable#managing_triggers_manually
GenericModel.prototype.runTriggers = function(e){
  const me = this;
  const src = e.source;
  //const activeSheet = src.getActiveSheet();
  //const activeRange = src.getActiveRange();

  me.triggers.forEach(trigger => trigger(me, src))
}


class Model extends GenericModel {  
  /**
      col: COL IDENTIFICATION,
      name: NAME OF VAR, 
      type: TYPES EXPECTED (a item or array), 
      validators: ARRAY OF VALIDATIONS,
      default: DEFAULT VALUE HERE OR INSERT FALSE,
      editable: True or False,
      writable: True or False,
      unique: True or False,
      required: True or False,
   */  

  getColumns(){
    // TODO make a set of cols for generate unique cols
    const cols = [
      { 
        col: this.column_id,
        name: 'id', 
        type: [String, Number], 
        validators: [],
        default: false,
        editable: false,
        writable: true,
        unique: true,
        required: false,
      },
      ...this.columns
    ]    

    return cols
  }

  getColumn(name){
    return this.getColumns().find(item => item.name.toLowerCase() === name.toLowerCase())
  }

  _validate(params, isCreate = false){     
    const columns = this.getColumns()    

    columns.forEach(col => {
      const isId = col.name === "ID" || col.name === 'id';

      // valid type
      if(col.type){
        if(Array.isArray(col.type)){          
          if(!col.type.some((type, index,array) => typeof type() === typeof params[col.name])){
            throw new ValidationError(col.name, `Campo não pode ser do tipo ${typeof params[col.name]}!`)          
          }
        }else{
          if(typeof col.type() !== typeof params[col.name]){          
            throw new ValidationError(col.name, `Campo não pode ser do tipo ${typeof params[col.name]}!`)          
          }
        }
      }

      //required
      if(col.required && !col.default && !(col.name in params)){
        throw new ValidationError(col.name, 'Campo não pode ser nulo!')
      }

      // default value 
      if(col.default && !params[col.name]){
        params[col.name] = col.default
      }
      
      // editable validator
      if(!isId && !isCreate && !col.editable && params[col.name]){        
        throw new ValidationError(col.name, 'Campo não pode ser alterado!')
      }
      
      // writable validator
      if(!col.writable && params[col.name]){
        delete params[col.name]
        //throw new ValidationError(col.name, 'Campo não pode ser escrito!')
      }

      // unique validator
      if(col.unique && col.required){

        const allValues = getColumnDataAsList(this.sheet, `${col.col}${this.data_range.row_start}:${col.col}`)

        if(!allValues.every(item => item !== params[col.name])) throw new ValidationError(col.name, 'Campo deve ser único!');
      }
    })    

    // Validator funcions
    Object.entries(params).forEach(([key, value]) => {
      const col = this.getColumn(key);

      col.validators.forEach(validator => {
        if(validator.validate(value)) throw new ValidationError(key, validator.message);
      })
    })
  }

  _insert(params, isCreate = false){    
    let row = this._getNextRowToInsert()    
    
    if ('id' in params && params['id']){      
      row = this._getRowNumberById(params.id)
    }else{
      params['id'] = this._getNextId()
    }

    this._validate(params, isCreate)

    Object.entries(params).forEach(([key, value]) => {
      const colNumber = getColumnNrByName(this.sheet, this.getColumn(key).col)
      this.sheet.getRange(row, colNumber).setValue(value);
    })
  }

  create(params = {}){
    if("ID" in params || 'id' in params){
      return this.update(params);
    }
    const isCreate = true

    this._insert(params, isCreate)
  }

  list(params = {}){
    let result = [[]]

    if('id' in params) {
      const rowNumber = this._getRowNumberById(params.id)
      let range = `A${rowNumber}:${getCharFromNumber(this.data_range.col_end)}${rowNumber}`
      result = this.sheet.getRange(range).getValues()
    }else if('conditional' in params && Object.keys(params).length > 1){
      const {conditional, ...filters} = params      

      result = this.sheet.getRange(this.data_range.row_start, 1, this.data_range.row_end, this.data_range.col_end).getValues();
      let mappedArr = [
        /*{
          key:'',
          value:'',
          position:0
        }*/
      ]

      mappedArr = Object.entries(filters).map(([key, value]) => {
        //array stats at 0
        return {key, value, position: getColumnNrByName(this.sheet, this.getColumn(key).col)-1}
      })

      result = result.filter(row => {                                
        if(conditional.toLowerCase()==='or'){
          return mappedArr.some(testable => row[testable.position] == testable.value)
        }else{ //and
          return mappedArr.every(testable => row[testable.position] == testable.value)
        }        
      })      
    }else{
      result = this.sheet.getRange(this.data_range.row_start, 1, this.data_range.row_end, this.data_range.col_end).getValues();
    }

    return result

  }

  update(params = {}){
    if(!('id' in params)) throw new Error("ID não pode ser nulo!");

    this._insert(params)
  }

  remove(params = {}){
    if(!('id' in params)) throw new Error("ID não pode ser nulo!");
    const rowPosition = this._getRowNumberById(params.id);

    const range = `A${rowPosition}:${getCharFromNumber(this.data_range.col_end)}${rowPosition}`

    const popValue = this.sheet.getRange(range).getValues()
    this.sheet.deleteRow(rowPosition)
    
    return popValue
  }
}
/** MODELS */

/** VALIDATIONS  */
const NotNullValidator = {
  message: "Este valor não pode ser nulo",
  validate: function (val) {
    return !val;
  }
}

const NotEmptyValidator = {
  message: "Este valor não pode ser vazio",
  validate: function (val) {
    return val && String(val).trim() === "";
  }
}
/** VALIDATIONS */

/** TRIGGERS */

/*Example = async function(me, src){        
  // if conditions are true
  if(true){    
    // do something
    // model.create , insert, update, remove, ....    
  }
}*/

AddIdIfNotExist = async function(me, src){    
  const activeRange = src.getActiveRange();
  const activeRow = activeRange.getRowIndex()
  const idColNumber = getColumnNrByName(me.sheet, me.column_id)
  
  const hasId = me.sheet.getRange(activeRow, idColNumber).getValue().trim() !== ""

  if(!hasId){
    await me.sheet.getRange(activeRow, idColNumber).setValue(me._getNextId());
  }    
}

OrderById = async function(me, src){
  const range = me.sheet.getRange(`A${me.data_range.row_start}:${me.column_id}`);
  await range.sort({column: getColumnNrByName(me.sheet, me.column_id), ascending: true});    
}
/** TRIGGERS */

/** Controller */
class Controller {
  constructor(model){
    this.model = model

    if(!model){
      throw new Error("Model não pode ser nul!");
    }
  }

  _convertArrayRowToColumnData(arr=[[]]){
    const rows = []

    arr.forEach((r, rowNumber) => {
      let rN = rowNumber + this.model.data_range.row_start
      rows[rN] = {}
      r.forEach((col, colNumber) => {
         rows[rN][getCharFromNumber(colNumber+1)] = col
      })
    })

    return rows
  }

  _testMappedCols(params, hasFilter = false){
    const columns = this.model.getColumns()    
    // valid id params is a mapped col
    Object.keys(params).forEach(item => {
      if(!columns.find(colCell => colCell.name.toLowerCase() === item.toLowerCase())) {
        // if has filter and is item param is 'conditional' jump throw error
        if(!(hasFilter && item.toLowerCase() === 'conditional')){
          throw new ValidationError(item, "Não foi mapeado")
        }
      }
    })
  }

  create(params={}){
    this._testMappedCols(params)

    this.model.create(params)
  }
  
  filterOR(params={}){
    params['conditional'] = 'or'
    return this.list(params)
  }
  filterAND(params={}){
    params['conditional'] = 'and'
    
    return this.list(params)
  }  

  list(params={}){
    let hasFilter = 'conditional' in params
  
    this._testMappedCols(params, hasFilter)

    return this._convertArrayRowToColumnData(this.model.list(params))
  }

  update(params={}){
    this._testMappedCols(params)

    this.model.update(params)
  }

  remove(params={}){
    this._testMappedCols(params)
    
    return this._convertArrayRowToColumnData(this.model.remove(params))    
  }
}
/** Controller */

/** API */
class API {
  constructor(controller){
    this._controller = controller;

    if(!controller) {
      throw new Error("Controller não pode ser nulo!");
    }
  }
  
  create(params={}) {  
    return new Promise((resolve, reject) => {      
      try{        
        resolve(this._controller.create(params))
      }catch(e){
        reject(e)
      }
    })
  }

  
  filterOR(params={}){
    return new Promise((resolve, reject) => {
      try{        
        resolve(this._controller.filterOR(params))
      }catch(e){
        reject(e)
      }
    })
  }

  filterAND(params={}){
    return new Promise((resolve, reject) => {
      try{        
        resolve(this._controller.filterAND(params))
      }catch(e){
        reject(e)
      }
    })
  }

  list(params={}){
    return new Promise((resolve, reject) => {
      try{        
        resolve(this._controller.list(params))
      }catch(e){
        reject(e)
      }
    })
  }

  update(params={}){
    return new Promise((resolve, reject) => {
      try{        
        resolve(this._controller.update(params))
      }catch(e){
        reject(e)
      }
    });
  }

  remove(params={}){
    return new Promise((resolve, reject) => {
      try{        
        resolve(this._controller.remove(params))
      }catch(e){
        reject(e)
      }
    });
  }
}
/** API */
