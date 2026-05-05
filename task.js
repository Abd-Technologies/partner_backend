var input = [1,2,3,2,1,3,5,6,2];
var arr = [];
for(var i=0; i<input.length; i++)
{
    var count = 1;
  for(var j=i+1; j<input.length ; j++)
  {    
    if(input[i] === input[j])
    {
      count++;
    }
       
  }    
        
}


